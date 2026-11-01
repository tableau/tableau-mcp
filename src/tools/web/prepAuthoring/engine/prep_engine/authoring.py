"""Editable YAML projects compiled to Tableau Prep metadata ZIP packages.

The native evidence establishes metadata structure, not an execution engine. No
Tableau operation, expression, connection or command is executed by this module.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from functools import partial
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4, uuid5

from .io import KNOWN_ENTRIES
from .logging import get_logger
from .schema import load_schema
from .value_contracts import SchemaValues

if TYPE_CHECKING:
    from .authoring_models import FlowDocument, FlowGraph

LOG = get_logger("authoring")
MAX_JSON_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 10_000
MAX_ITEMS = 1_000_000
ALIAS_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,79}$")
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


class AuthoringError(ValueError):
    """An invalid or unsafe authoring project; no package is published."""


@dataclass(frozen=True)
class IdRef:
    label: str


@dataclass(frozen=True)
class JsonRef:
    path: str


@dataclass(frozen=True)
class PathRef:
    path: str


@dataclass
class CompiledFlow:
    document: dict[str, Any]
    files: dict[str, bytes]
    inputs: set[Path]
    errors: list[str]
    warnings: list[str]
    model: FlowDocument | None = None

    def result(self) -> dict[str, Any]:
        from .authoring_models import ValidationResult
        return ValidationResult(
            valid=not self.errors, errors=self.errors, warnings=self.warnings,
            nodeCount=len(self.document.get("flow", {}).get("nodes", {})),
            attachmentCount=len(self.files),
        ).model_dump(by_alias=True)


def _event(operation: str, event: str, target: Path, reason: str | None = None) -> None:
    LOG.log(40 if event == "failure" else 20, operation.replace("-", " "), extra={
        "operation": operation, "event": event, "outcome": event,
        "target": str(target), "failure_reason": reason,
    })


def _codec() -> tuple[Any, Any, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise AuthoringError("Install authoring dependencies: pip install -e '.[authoring]'") from exc

    class Loader(yaml.SafeLoader):
        # Keep YAML 1.1's 'on', 'off', dates, etc. as text in Tableau payloads.
        yaml_implicit_resolvers = {
            k: [(tag, pattern) for tag, pattern in rules
                if tag not in ("tag:yaml.org,2002:bool", "tag:yaml.org,2002:timestamp")]
            for k, rules in yaml.SafeLoader.yaml_implicit_resolvers.items()
        }

        def compose_node(self, parent: Any, index: Any) -> Any:
            if self.check_event(yaml.AliasEvent):
                raise AuthoringError("YAML aliases are unsupported; use !include for shared data")
            depth = getattr(self, "_depth", 0) + 1
            count = getattr(self, "_count", 0) + 1
            if depth > 100 or count > MAX_ITEMS:
                raise AuthoringError("YAML nesting or item limit exceeded")
            self._depth, self._count = depth, count
            try:
                return super().compose_node(parent, index)
            finally:
                self._depth -= 1

    def mapping(loader: Any, node: Any) -> dict[Any, Any]:
        result: dict[Any, Any] = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=True)
            if not isinstance(key, (str, IdRef)):
                raise AuthoringError("YAML mapping keys must be strings or !id references")
            if key in result:
                raise AuthoringError(f"Duplicate YAML key at line {key_node.start_mark.line + 1}")
            result[key] = loader.construct_object(value_node, deep=True)
        return result

    Loader.add_implicit_resolver("tag:yaml.org,2002:bool", re.compile(r"^(?:true|false)$", re.I), list("tTfF"))
    Loader.add_constructor("tag:yaml.org,2002:map", mapping)

    def construct_ref(loader: Any, node: Any, *, ref_type: type[IdRef] | type[JsonRef] | type[PathRef]) -> IdRef | JsonRef | PathRef:
        return ref_type(loader.construct_scalar(node))

    for tag, cls in (("!id", IdRef), ("!include", JsonRef), ("!path", PathRef)):
        Loader.add_constructor(tag, partial(construct_ref, ref_type=cls))

    class Dumper(yaml.SafeDumper):
        def ignore_aliases(self, data: Any) -> bool:
            return True

    def represent_ref(dumper: Any, value: Any, *, tag: str, attr: str) -> Any:
        return dumper.represent_scalar(tag, getattr(value, attr))

    for cls, tag, attr in ((IdRef, "!id", "label"), (JsonRef, "!include", "path"), (PathRef, "!path", "path")):
        Dumper.add_representer(cls, partial(represent_ref, tag=tag, attr=attr))
    return yaml, Loader, Dumper


def _json_bytes(value: Any) -> bytes:
    import io
    buffer = io.BytesIO()
    encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    for chunk in encoder.iterencode(value):
        encoded = chunk.encode("utf-8")
        if buffer.tell() + len(encoded) + 1 > MAX_JSON_BYTES:
            raise AuthoringError("Generated JSON metadata exceeds size limit")
        buffer.write(encoded)
    buffer.write(b"\n")
    return buffer.getvalue()


def _json_load(raw: bytes) -> Any:
    if len(raw) > MAX_JSON_BYTES:
        raise AuthoringError("JSON metadata/include exceeds 32 MiB")

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise AuthoringError("Duplicate JSON object key")
            result[key] = value
        return result

    def invalid_constant(value: str) -> Any:
        raise AuthoringError("Non-finite JSON number")

    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs, parse_constant=invalid_constant)


def _entry_name(name: str) -> str:
    if not name or any(c in name for c in '\\:*?<>"|') or any(ord(c) < 32 for c in name):
        raise AuthoringError("Archive/resource paths must be portable relative POSIX paths")
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in ("", ".", "..") for p in name.split("/")):
        raise AuthoringError("Archive/resource path escapes or contains an empty component")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if any(p.endswith((".", " ")) or p.split(".")[0].upper() in reserved for p in path.parts):
        raise AuthoringError("Archive/resource path contains a reserved Windows component")
    return path.as_posix()


def _local_file(root: Path, name: str, inputs: set[Path]) -> Path:
    relative = _entry_name(name)
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise AuthoringError(f"Resource is missing or outside the YAML project: {relative}")
    inputs.add(path)
    return path


def _read_limited(path: Path, limit: int) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise AuthoringError(f"File size limit exceeded: {path.name}")
    return data


def _ensure_json(value: Any, depth: int = 0, budget: list[int] | None = None) -> None:
    budget = budget if budget is not None else [MAX_ITEMS]
    budget[0] -= 1
    if depth > 100 or budget[0] < 0:
        raise AuthoringError("JSON nesting or item limit exceeded")
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise AuthoringError("Resolved metadata keys must be strings")
            _ensure_json(v, depth + 1, budget)
    elif isinstance(value, list):
        for v in value:
            _ensure_json(v, depth + 1, budget)
    elif isinstance(value, float) and not math.isfinite(value):
        raise AuthoringError("Non-finite metadata number")
    elif value is not None and not isinstance(value, (str, int, float, bool)):
        raise AuthoringError("Metadata contains a non-JSON value")


def _uuid(text: Any) -> bool:
    try:
        return isinstance(text, str) and str(UUID(text)) == text.lower()
    except ValueError:
        return False


def _prepare_graph(graph: dict[str, Any], id_for: Any, defaults: bool, contracts: SchemaValues) -> None:
    nodes = graph.get("nodes")
    if not isinstance(nodes, dict):
        raise AuthoringError("Every flow graph requires a nodes mapping")
    normalized: dict[str, Any] = {}
    for key, node in nodes.items():
        node_id = key if _uuid(key) else id_for(key)
        if node_id in normalized:
            raise AuthoringError("Node aliases resolve to the same UUID")
        if not isinstance(node, dict):
            raise AuthoringError("Every node must be a mapping")
        node.setdefault("id", node_id)
        if defaults:
            node.setdefault("name", key)
            contracts.apply_defaults(node, "commonNode")
            variant = contracts.node_variant(node.get("nodeType"))
            if variant:
                contracts.apply_defaults(node, variant)
            for edge in node.get("nextNodes", []):
                if isinstance(edge, dict):
                    contracts.apply_defaults(edge, "edge")
        child = node.get("loomContainer")
        if isinstance(child, dict):
            _prepare_graph(child, id_for, defaults, contracts)
        elif child is not None:
            raise AuthoringError("loomContainer must be a graph mapping")
        normalized[node_id] = node
    graph["nodes"] = normalized
    if defaults:
        targets = {edge.get("nextNodeId") for node in normalized.values()
                   for edge in node.get("nextNodes", []) if isinstance(edge, dict)}
        graph.setdefault("initialNodes", [key for key in normalized if key not in targets])
        version_defaults = contracts.template("flow")
        for key in ("majorVersion", "minorVersion"):
            graph.setdefault(key, version_defaults[key])


def _graph_errors(flow: FlowGraph) -> list[str]:
    errors: list[str] = []
    connections = flow.connections or {}
    seen: set[UUID] = set()

    def visit(graph: FlowGraph, path: str) -> None:
        nodes = graph.nodes
        incoming = dict.fromkeys(nodes, 0)
        for initial in graph.initial_nodes or []:
            if initial not in nodes:
                errors.append(f"{path}.initialNodes: missing node {initial}")
        for key, node in nodes.items():
            if UUID(key) in seen:
                errors.append(f"{path}.nodes.{key}: duplicate semantic node ID")
            seen.add(UUID(key))
            if node.id != key:
                errors.append(f"{path}.nodes.{key}: id differs from mapping key")
            connection = node.connection_id
            external_output = node.node_type.endswith(".WriteToDataCloud")
            if connection and connection not in connections and not (external_output and not _uuid(connection)):
                errors.append(f"{path}.nodes.{key}.connectionId: missing connection")
            for edge in node.next_nodes or []:
                target = edge.next_node_id
                if target not in nodes:
                    errors.append(f"{path}.nodes.{key}.nextNodes: missing node {target}")
                else:
                    incoming[target] += 1
            child = node.loom_container
            if child is not None:
                visit(child, f"{path}.nodes.{key}.loomContainer")
                for direction, bindings in (("namespacesToInput", node.namespaces_to_input), ("namespacesToOutput", node.namespaces_to_output)):
                    for binding in (bindings or {}).values():
                        if binding.node_id not in child.nodes:
                            errors.append(f"{path}.nodes.{key}.{direction}: missing child node")
        queue = [key for key, degree in incoming.items() if degree == 0]
        visited = 0
        while queue:
            current = queue.pop()
            visited += 1
            for edge in nodes[current].next_nodes or []:
                target = edge.next_node_id
                if target in incoming:
                    incoming[target] -= 1
                    if incoming[target] == 0:
                        queue.append(target)
        if visited != len(nodes):
            errors.append(f"{path}.nodes: graph contains a cycle")

    visit(flow, "flow")
    for key, connection in connections.items():
        if connection.id is not None and connection.id != key:
            errors.append("flow.connections: id differs from mapping key")
    for key in flow.connection_ids or []:
        if key not in connections:
            errors.append("flow.connectionIds: missing connection")
    for data_key in flow.data_connection_ids or []:
        if data_key not in (flow.data_connections or {}):
            errors.append("flow.dataConnectionIds: missing data connection")
    return errors


def _schema_errors(document: dict[str, Any], schema: dict[str, Any] | None = None) -> list[str]:
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise AuthoringError("Full validation requires: pip install -e '.[authoring]'") from exc
    schema = schema if schema is not None else load_schema()
    validator = Draft202012Validator(schema)
    # Do not echo whole invalid nodes, which can contain connection credentials.
    errors = [f"{'.'.join(map(str, e.absolute_path)) or '$'}: {e.validator} constraint failed"
              for e in validator.iter_errors(document)]
    graph_validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/flow"})

    def children(graph: dict[str, Any], path: str) -> None:
        for key, node in graph["nodes"].items():
            child = node.get("loomContainer")
            if isinstance(child, dict):
                prefix = f"{path}.nodes.{key}.loomContainer"
                errors.extend(f"{prefix}.{'.'.join(map(str, e.absolute_path))}: {e.validator} constraint failed"
                              for e in graph_validator.iter_errors(child))
                children(child, prefix)

    children(document["flow"], "flow")
    return errors


def compile_flow_yaml(source: str | Path, package_type: str = "tfl") -> CompiledFlow:
    source = Path(source).resolve()
    _event("compile-flow-yaml", "start", source)
    try:
        yaml, Loader, _ = _codec()
        inputs = {source}
        root = source.parent
        raw_source = _read_limited(source, MAX_JSON_BYTES)
        authored = yaml.load(raw_source.decode("utf-8-sig"), Loader=Loader)
        include_budget = MAX_TOTAL_BYTES - len(raw_source)
        contracts = SchemaValues(load_schema())
        project_properties = contracts.definition("authoringProject")["properties"]
        project_format = project_properties["format"]["const"]
        if not isinstance(authored, dict) or authored.get("format") != project_format:
            raise AuthoringError(f"YAML format must be {project_format}")
        if set(authored) - set(project_properties):
            raise AuthoringError("Unknown project key; metadata extensions belong inside flow/displaySettings/maestroMetadata")
        if package_type not in ("tfl", "tflx"):
            raise AuthoringError("Package type must be tfl or tflx")
        namespace = UUID(str(authored["namespace"]))
        defaults = authored.get("defaults", project_properties["defaults"]["default"])
        if type(defaults) is not bool:
            raise AuthoringError("defaults must be true or false")

        def include(value: JsonRef) -> Any:
            nonlocal include_budget
            raw = _read_limited(_local_file(root, value.path, inputs), min(MAX_JSON_BYTES, max(0, include_budget)))
            include_budget -= len(raw)
            return _json_load(raw)

        ids = authored.get("ids", {})
        ids = include(ids) if isinstance(ids, JsonRef) else ids
        if not isinstance(ids, dict) or any(not isinstance(k, str) or not ALIAS_RE.fullmatch(k) or not _uuid(v) for k, v in ids.items()):
            raise AuthoringError("ids must map short labels to UUID strings")
        if len(set(ids.values())) != len(ids):
            raise AuthoringError("ids contains duplicate UUIDs")
        claimed = {value: label for label, value in ids.items()}

        def id_for(label: str) -> str:
            if not ALIAS_RE.fullmatch(label):
                raise AuthoringError("ID label must start with a letter and contain only letters, numbers, _ or -")
            resolved: str = ids.get(label, str(uuid5(namespace, label)))
            if resolved in claimed and claimed[resolved] != label:
                raise AuthoringError("ID labels resolve to the same UUID")
            claimed[resolved] = label
            return resolved

        def expand(value: Any) -> Any:
            if isinstance(value, IdRef):
                return id_for(value.label)
            if isinstance(value, JsonRef):
                return include(value)
            if isinstance(value, PathRef):
                return str(_local_file(root, value.path, inputs))
            if isinstance(value, dict):
                out = {}
                for key, item in value.items():
                    key = expand(key)
                    if key in out:
                        raise AuthoringError("Mapping keys collide after ID expansion")
                    out[key] = expand(item)
                return out
            if isinstance(value, list):
                return [expand(item) for item in value]
            return value

        document = {key: expand(authored[key]) for key in KNOWN_ENTRIES if key in authored}
        _ensure_json(document)
        flow = document.get("flow")
        if not isinstance(flow, dict):
            raise AuthoringError("flow must be a mapping with nodes")
        _prepare_graph(flow, id_for, defaults, contracts)
        connections = flow.get("connections", {})
        if not isinstance(connections, dict):
            raise AuthoringError("flow.connections must be a mapping")
        normalized = {}
        for key, connection in connections.items():
            key = key if _uuid(key) else id_for(key)
            if key in normalized or not isinstance(connection, dict):
                raise AuthoringError("Invalid or colliding connection mapping")
            normalized[key] = connection
        if "connections" in flow:
            flow["connections"] = normalized
        if defaults:
            contracts.apply_defaults(flow, "flow")
            flow.setdefault("connectionIds", list(normalized))
            for key in ("documentId", "obfuscatorId"):
                strategy = contracts.definition("flow")["properties"][key]["x-authoring-generated"]
                if not isinstance(strategy, str) or not strategy.startswith("uuid5:"):
                    raise AuthoringError("Unsupported schema ID generation strategy")
                flow.setdefault(key, str(uuid5(namespace, strategy.removeprefix("uuid5:"))))
        if "displaySettings" not in document:
            _event("compile-flow-yaml", "fallback", source, "standard display settings generated")
            display = contracts.template("displaySettings")
            spacing = contracts.definition("nodeDisplaySettings")["x-authoring-node-spacing"]
            for index, key in enumerate(flow["nodes"]):
                node_display = contracts.template("nodeDisplaySettings")
                node_display["position"]["x"] += index * spacing
                display["flowDisplaySettings"]["flowNodeDisplaySettings"][key] = node_display
            document["displaySettings"] = display
        manifest = document.setdefault("maestroMetadata", contracts.template("maestroMetadata"))
        if not isinstance(manifest, dict):
            raise AuthoringError("maestroMetadata must be a mapping")
        for key in ("flowEntryName", "displaySettingsEntryName"):
            expected = contracts.definition("maestroMetadata")["properties"][key]["const"]
            if key in manifest and manifest[key] != expected:
                raise AuthoringError(f"maestroMetadata.{key} must be {expected}")
            manifest.setdefault(key, expected)
        manifest["isPackagedMaestroDocument"] = package_type == "tflx"
        files = {}
        records = expand(authored.get("files", []))
        if not isinstance(records, list) or len(records) > MAX_ENTRIES - 3:
            raise AuthoringError("files must be a bounded list of entry/source mappings")
        total = sum(len(_json_bytes(v)) for v in document.values())
        occupied = {name.casefold() for name in KNOWN_ENTRIES}
        for record in records:
            if not isinstance(record, dict) or set(record) != {"entry", "source"}:
                raise AuthoringError("Each file requires exactly entry and source")
            entry = record["entry"]
            if isinstance(entry, list) and all(isinstance(p, str) for p in entry):
                entry = "/".join(entry)
            if not isinstance(entry, str) or not isinstance(record["source"], str):
                raise AuthoringError("File entry and source must be relative paths")
            entry = _entry_name(entry)
            if entry.casefold() in occupied:
                raise AuthoringError("Duplicate or reserved package entry")
            occupied.add(entry.casefold())
            if package_type == "tfl" and entry.split("/")[0].casefold() == "data":
                raise AuthoringError("Embedded Data requires tflx; use an external !path for tfl")
            data = _read_limited(_local_file(root, record["source"], inputs), MAX_TOTAL_BYTES - total)
            files[entry] = data
            total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise AuthoringError("Package size limit exceeded")
        errors = _schema_errors(document, contracts.schema)
        typed_document = None
        if not errors:
            try:
                from pydantic import ValidationError
                from .authoring_models import FlowDocument
            except ImportError as exc:
                raise AuthoringError("Typed validation requires: pip install -e '.[authoring]'") from exc
            try:
                typed_document = FlowDocument.model_validate(document)
            except ValidationError as exc:
                # Do not include values or whole connection nodes in diagnostics.
                errors.extend(f"{'.'.join(map(str, e['loc']))}: typed {e['type']} constraint failed"
                              for e in exc.errors(include_url=False, include_input=False))
            if typed_document is not None:
                if typed_document.to_document() != document:
                    raise AuthoringError("Typed metadata serialization changed the source values")
                errors.extend(_graph_errors(typed_document.flow))
        warnings = ["Schema and graph validation do not execute Tableau Prep or guarantee every private operation's runtime compatibility."]
        compiled = CompiledFlow(document, files, inputs, errors, warnings, typed_document)
    except Exception as exc:
        _event("compile-flow-yaml", "failure", source, type(exc).__name__)
        raise
    _event("compile-flow-yaml", "failure" if errors else "success", source,
           "schema or reference constraints failed" if errors else None)
    return compiled


def validate_flow_yaml(source: str | Path, package_type: str = "tfl") -> dict[str, Any]:
    try:
        return compile_flow_yaml(source, package_type).result()
    except Exception as exc:
        return {"valid": False, "errors": [str(exc)], "warnings": []}


def _publish_bytes(path: Path, data: bytes, overwrite: bool = False) -> None:
    if path.is_symlink() or (path.exists() and not overwrite):
        raise FileExistsError(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".prep-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        if overwrite:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)  # Atomic no-clobber publication on NTFS and POSIX.
    finally:
        temporary.unlink(missing_ok=True)


def build_flow_package(source: str | Path, output: str | Path, *, overwrite: bool = False) -> dict[str, Any]:
    output = Path(output).absolute()
    _event("build-flow-package", "start", output)
    try:
        compiled = compile_flow_yaml(source, output.suffix.lower().lstrip("."))
        if compiled.errors:
            raise AuthoringError("YAML validation failed: " + "; ".join(compiled.errors[:10]))
        if output.resolve() in compiled.inputs:
            raise AuthoringError("Output would overwrite a project input")
        # Serialize all entries before touching the destination.
        entries = {**compiled.files, **{name: _json_bytes(value) for name, value in compiled.document.items()}}
        import io
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name in sorted(entries):
                info = zipfile.ZipInfo(name, FIXED_TIME)
                info.create_system = 0
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, entries[name], compresslevel=9)
        data = buffer.getvalue()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if any(_json_load(archive.read(name)) != compiled.document[name] for name in KNOWN_ENTRIES):
                raise AuthoringError("Generated metadata roundtrip differs")
            if archive.testzip() is not None:
                raise AuthoringError("Generated archive CRC verification failed")
        _publish_bytes(output, data, overwrite)
    except Exception as exc:
        _event("build-flow-package", "failure", output, type(exc).__name__)
        raise
    _event("build-flow-package", "success", output)
    return {**compiled.result(), "output": str(output), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def _source_entries(source: Path) -> dict[str, bytes]:
    entries: dict[str, bytes] = {}
    occupied: set[str] = set()
    total = 0

    def add(name: str, size: int, read: Any) -> None:
        nonlocal total
        name = _entry_name(name)
        if name.casefold() in occupied or len(occupied) >= MAX_ENTRIES:
            raise AuthoringError("Duplicate archive entry or entry count limit exceeded")
        if size > MAX_TOTAL_BYTES - total:
            raise AuthoringError("Package size limit exceeded")
        total += size
        occupied.add(name.casefold())
        entries[name] = read()

    if source.is_dir():
        for path in sorted(source.rglob("*")):
            if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
                raise AuthoringError("Expanded package contains a link")
            if path.is_file():
                add(path.relative_to(source).as_posix(), path.stat().st_size,
                    lambda path=path: _read_limited(path, MAX_TOTAL_BYTES))
    else:
        with zipfile.ZipFile(source) as archive:
            if len(archive.infolist()) > MAX_ENTRIES:
                raise AuthoringError("Package entry count limit exceeded")
            for info in archive.infolist():
                if info.is_dir():
                    _entry_name(info.filename.rstrip("/"))
                    continue
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise AuthoringError("Package contains a symbolic link")
                add(info.filename, info.file_size, lambda info=info: archive.read(info))
    if "flow" not in entries:
        raise AuthoringError("Package has no flow entry")
    return entries


def _write_project(output: Path, authored: dict[str, Any], resources: dict[str, bytes]) -> Path:
    yaml, _, Dumper = _codec()
    resource_dir = output.with_name(output.stem + ".resources")
    if output.exists() or resource_dir.exists() or output.is_symlink() or resource_dir.is_symlink():
        raise FileExistsError("YAML project or resources already exist")
    text = yaml.dump(authored, Dumper=Dumper, allow_unicode=True, sort_keys=False, width=120)
    output.parent.mkdir(parents=True, exist_ok=True)
    resource_dir.mkdir()
    try:
        for name, data in resources.items():
            _publish_bytes(resource_dir / _entry_name(name), data)
        _publish_bytes(output, text.encode("utf-8"))
    except Exception:
        # This directory was exclusively created by this call; no pre-existing data.
        shutil.rmtree(resource_dir)
        raise
    return output


def export_flow_yaml(source: str | Path, output: str | Path, *, externalize_bytes: int = 1024) -> dict[str, Any]:
    source, output = Path(source).resolve(), Path(output).absolute()
    _event("export-flow-yaml", "start", source)
    try:
        if externalize_bytes < 1:
            raise AuthoringError("externalize_bytes must be positive")
        entries = _source_entries(source)
        document = {name: _json_load(entries.pop(name)) for name in KNOWN_ENTRIES if name in entries}
        _ensure_json(document)
        resources: dict[str, bytes] = {}
        prefix = output.stem + ".resources/"
        ids: dict[str, str] = {}
        by_uuid: dict[str, str] = {}

        def shorten(value: Any, key: str | None = None) -> Any:
            if isinstance(value, str) and _uuid(value):
                if value not in by_uuid:
                    label = f"n{len(ids) + 1}"
                    by_uuid[value], ids[label] = label, value
                return IdRef(by_uuid[value])
            if key == "values" and isinstance(value, (dict, list)) and len(_json_bytes(value)) >= externalize_bytes:
                name = f"values-{len(resources) + 1}.json"
                resources[name] = _json_bytes(value)
                return JsonRef(prefix + name)
            if isinstance(value, dict):
                return {shorten(k): shorten(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [shorten(v) for v in value]
            return value

        authored = {**SchemaValues(load_schema()).template("authoringProject"), "namespace": str(uuid4()), "defaults": False,
                    "ids": JsonRef(prefix + "ids.json"), "flow": shorten(document["flow"])}
        resources["ids.json"] = _json_bytes(ids)
        for name in ("displaySettings", "maestroMetadata"):
            if name in document:
                resources[name + ".json"] = _json_bytes(document[name])
                authored[name] = JsonRef(prefix + name + ".json")
        authored["files"] = []
        for index, (entry, data) in enumerate(sorted(entries.items())):
            name = f"attachment-{index + 1}.bin"
            resources[name] = data
            authored["files"].append({"entry": entry, "source": prefix + name})
        _write_project(output, authored, resources)
    except Exception as exc:
        _event("export-flow-yaml", "failure", source, type(exc).__name__)
        raise
    _event("export-flow-yaml", "success", output)
    return {"output": str(output), "resources": str(output.with_name(output.stem + ".resources")),
            "idCount": len(ids), "attachmentCount": len(entries)}


def new_flow_yaml(output: str | Path, package_type: str = "tfl") -> dict[str, Any]:
    """Create a self-contained authoring example, without reading a TFL/TFLX."""
    output = Path(output).absolute()
    _event("new-flow-yaml", "start", output)
    try:
        if package_type not in ("tfl", "tflx"):
            raise AuthoringError("Package type must be tfl or tflx")
        contracts = SchemaValues(load_schema())
        prefix = output.stem + ".resources/"
        packaged = package_type == "tflx"
        csv_values = contracts.template("nodeVariants/loadCsv")
        authored = {
            **contracts.template("authoringProject"), "namespace": str(uuid4()),
            "flow": {
                "nodes": {
                    "input": {**csv_values, "name": "Sales",
                              "connectionId": IdRef("csv"), "connectionAttributes": {},
                              "nextNodes": [{**contracts.template("edge"), "nextNodeId": IdRef("calculate")}]},
                    "calculate": {**contracts.template("nodeVariants/addColumn"), "name": "Tax included",
                                  "columnName": "SalesWithTax", "expression": "[Sales] * 1.1",
                                  "nextNodes": [{**contracts.template("edge"), "nextNodeId": IdRef("output")}]},
                    "output": {**contracts.template("nodeVariants/writeToHyper"), "name": "Result",
                               "hyperOutputFile": "sales-output.hyper", "tdsOutput": "sales-output.tds"},
                },
                "connections": {"csv": {**contracts.template("authoringCsvConnection"), "id": IdRef("csv"),
                                        "name": "sales.csv", "isPackaged": packaged,
                                        "connectionAttributes": {**contracts.template("authoringCsvConnection")["connectionAttributes"], "filename":
                                            "sales.csv" if packaged else PathRef(prefix + "sales.csv")}}},
            },
            "files": [{"entry": ["Data", IdRef("csv"), "sales.csv"], "source": prefix + "sales.csv"}] if packaged else [],
        }
        import csv
        import io
        separator = csv_values["separator"]
        delimiter = "\t" if separator == "\\t" else separator
        if not isinstance(delimiter, str) or len(delimiter) != 1:
            raise AuthoringError("Starter CSV requires a single-character separator or escaped tab")
        content = io.StringIO(newline="")
        writer = csv.writer(content, delimiter=delimiter, lineterminator="\n")
        if csv_values["containsHeaders"]:
            writer.writerow(["Region", "Sales"])
        writer.writerows([["East", 100], ["West", 200]])
        _write_project(output, authored, {"sales.csv": content.getvalue().encode(csv_values["charSet"])})
    except Exception as exc:
        _event("new-flow-yaml", "failure", output, type(exc).__name__)
        raise
    _event("new-flow-yaml", "success", output)
    return {"output": str(output), "packageType": package_type, "nodeCount": 3}
