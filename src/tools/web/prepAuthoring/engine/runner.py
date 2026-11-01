"""Fixed stdin protocol around the migrated, declarative Prep YAML compiler.

No Tableau credentials, network operations, native runtime or script execution.
"""

from __future__ import annotations

import base64
from decimal import Decimal
import hashlib
import io
import json
import logging
from pathlib import Path
import re
import stat
import sys
import uuid

MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_YAML = 1024 * 1024
ROOT: Path


class NativeBuffer(io.BytesIO):
    def is_dir(self):
        return False


class BoundaryError(ValueError):
    def __init__(self, code="UNSAFE_PROJECT"):
        self.code = code


def identity(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise BoundaryError()
    return value


def no_links(path):
    if not path.is_relative_to(ROOT):
        raise BoundaryError()
    for item in (path, *path.parents):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            raise BoundaryError()
        if item == ROOT:
            break


def local_path(relative):
    if not isinstance(relative, str) or len(relative) > 4096:
        raise BoundaryError()
    parts = relative.replace("\\", "/").split("/")
    if (
        not relative
        or ":" in relative
        or relative.startswith(("/", "\\"))
        or ".." in parts
    ):
        raise BoundaryError()
    path = ROOT.joinpath(*parts)
    no_links(path)
    if not path.resolve().is_relative_to(ROOT):
        raise BoundaryError()
    return path


def read_regular(path, limit=MAX_FILE):
    from prep_engine.bounded_io import read_bounded_regular_file

    path = Path(path)
    no_links(path)
    before = path.lstat()
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
        or before.st_size > min(limit, MAX_TOTAL)
    ):
        raise BoundaryError()
    data = read_bounded_regular_file(path, min(limit, MAX_TOTAL))
    current = path.lstat()

    def fields(s):
        return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)

    if len(data) > limit or fields(before) != fields(current):
        raise BoundaryError("SOURCE_CHANGED")
    no_links(path)
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exact_json_numbers(raw, decoded):
    precise = json.loads(raw, parse_float=Decimal)
    pending = [(precise, decoded)]
    while pending:
        left, right = pending.pop()
        if isinstance(left, Decimal):
            if not left.is_finite() or left != Decimal(str(right)):
                raise BoundaryError("NUMERIC_PRECISION_UNSUPPORTED")
        elif isinstance(left, dict):
            pending.extend((v, right[k]) for k, v in left.items())
        elif isinstance(left, list):
            pending.extend(zip(left, right))


def manifest(directory):
    no_links(directory)
    files, total = {}, 0
    for path in sorted(directory.rglob("*")):
        no_links(path)
        if path.is_dir():
            continue
        raw = read_regular(path, MAX_TOTAL - total)
        total += len(raw)
        files[path.relative_to(directory).as_posix()] = digest(raw)
        if len(files) > 4096 or total > MAX_TOTAL:
            raise BoundaryError()
    return digest(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    ), files


def scope_check(value):
    """Reject provider settings and inline secrets before any YAML disclosure."""
    from prep_engine.credential_policy import (
        AUTH_VALUE_CONTAINERS,
        credential_kind,
        contains_inline_credential,
    )

    stack, count = [(value, False)], 0
    files = {
        "textscan",
        "excel-direct",
        "hyper",
        "json",
        "stat-direct",
        "dataengine",
        "sqlproxy",
        "tableau",
        "tableauserver",
    }
    while stack:
        current, auth_scope = stack.pop()
        count += 1
        if count > 100000:
            raise BoundaryError()
        if isinstance(current, dict):
            for key, child in current.items():
                kind = credential_kind(key)
                if (
                    kind == "secret" or (auth_scope and kind == "principal")
                ) and child not in (None, "", False, [], {}):
                    raise BoundaryError("CREDENTIAL_METADATA_UNSUPPORTED")
                if key in {
                    "connectionAttributes",
                    "modifiedConnectionAttributes",
                } and isinstance(child, dict):
                    kind = child.get("class")
                    if kind is not None and kind not in files:
                        raise BoundaryError("DATABASE_PROVIDER_UNSUPPORTED")
                if key in {"query", "sql", "customSql"} and child not in (None, ""):
                    raise BoundaryError("DATABASE_PROVIDER_UNSUPPORTED")
                stack.append((child, auth_scope or key in AUTH_VALUE_CONTAINERS))
        elif isinstance(current, list):
            stack.extend((child, auth_scope) for child in current)
        elif contains_inline_credential(current):
            raise BoundaryError("CREDENTIAL_METADATA_UNSUPPORTED")


def summary(document):
    types, stack = set(), [document]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if isinstance(value.get("nodeType"), str):
                types.add(value["nodeType"])
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return {
        "hasScriptSteps": any(
            "Extensibility" in t or t.endswith(".Script") for t in types
        ),
        "hasInputUnion": any("InputUnion" in t for t in types),
        "hasFileInputs": any(
            re.search(r"\.Load(Csv|Excel|Json|Hyper|Statistical)", t) for t in types
        ),
    }


def copy_project(source, target):
    fingerprint, files = manifest(source)
    for name in files:
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        no_links(path)
        with path.open("xb") as stream:
            stream.write(read_regular(source / name, MAX_TOTAL))
    if manifest(source)[0] != fingerprint:
        raise BoundaryError("SOURCE_CHANGED")


def execute(request):
    global ROOT
    workspace = Path(request["workspace"])
    if (
        not workspace.is_absolute()
        or str(workspace).startswith(("\\\\", "//"))
        or workspace.is_symlink()
        or not workspace.is_dir()
    ):
        raise BoundaryError()
    ROOT = workspace.resolve(strict=True)
    if request.get("format") not in {"tfl", "tflx"}:
        raise BoundaryError()
    deps = request.get("dependencies")
    if deps:
        dependency_path = Path(deps)
        if not dependency_path.is_absolute() or not dependency_path.is_dir():
            raise BoundaryError()
        sys.path.insert(0, str(dependency_path.resolve(strict=True)))
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from prep_engine import authoring as engine

    (
        engine.MAX_JSON_BYTES,
        engine.MAX_TOTAL_BYTES,
        engine.MAX_ENTRIES,
        engine.MAX_ITEMS,
    ) = MAX_FILE, MAX_TOTAL, 4096, 100000
    engine._read_limited = read_regular
    logging.disable(logging.CRITICAL)
    cache = local_path(".tableau-prep-mcp")
    cache.mkdir(mode=0o700, exist_ok=True)
    no_links(cache)
    job = cache / identity(request["jobId"])
    operation = request["operation"]
    if operation == "prepare":
        if len(list(cache.iterdir())) >= 20:
            raise BoundaryError("WORKSPACE_PROJECT_LIMIT")
        job.mkdir(mode=0o700)
        base = job / "base"
        base.mkdir(mode=0o700)
        source = request["source"]
        source_hash = None
        if source["type"] == "new":
            engine.new_flow_yaml(base / "project.yml", request["format"])
        else:
            if source["type"] == "local":
                original = local_path(source["path"])
                if original.suffix.lower() not in {".tfl", ".tflx"}:
                    raise BoundaryError()
                raw = read_regular(original)
            elif source["type"] == "download":
                raw = base64.b64decode(source["base64"], validate=True)
            else:
                raise BoundaryError()
            if len(raw) > MAX_FILE:
                raise BoundaryError()
            source_hash = digest(raw)

            entries = engine._source_entries(NativeBuffer(raw))
            document = {
                name: engine._json_load(entries[name]) for name in engine.KNOWN_ENTRIES
            }
            scope_check(document)
            for name, value in document.items():
                exact_json_numbers(entries[name], value)
            native = job / "original.tflx"
            with native.open("xb") as stream:
                stream.write(raw)
            engine.export_flow_yaml(
                native, base / "project.yml", externalize_bytes=1024
            )
        resources = []
        if len(request.get("resources", [])) > 20:
            raise BoundaryError()
        for relative in request.get("resources", []):
            original = local_path(relative)
            if original.suffix.lower() not in {
                ".csv",
                ".tsv",
                ".xlsx",
                ".xls",
                ".json",
                ".hyper",
                ".tde",
                ".txt",
            }:
                raise BoundaryError()
            target = base / "user-resources" / original.name
            target.parent.mkdir(exist_ok=True)
            data = read_regular(original)
            with target.open("xb") as stream:
                stream.write(data)
            resources.append(
                {
                    "path": target.relative_to(base).as_posix(),
                    "bytes": len(data),
                    "sha256": digest(data),
                }
            )
        yaml_bytes = read_regular(base / "project.yml", MAX_YAML)
        compiled = engine.compile_flow_yaml(base / "project.yml", request["format"])
        scope_check(compiled.document)
        return {
            "ok": True,
            "valid": not compiled.errors,
            "yaml": yaml_bytes.decode("utf-8"),
            "projectSha256": manifest(base)[0],
            "sourceSha256": source_hash,
            "resources": resources,
            "summary": summary(compiled.document),
            "nativeExecutionVerified": False,
        }
    no_links(job)
    base = job / "base"
    if manifest(base)[0] != request["projectSha256"]:
        raise BoundaryError("SOURCE_CHANGED")
    if operation == "preview":
        yaml_text = request["yaml"]
        if not isinstance(yaml_text, str) or len(yaml_text.encode("utf-8")) > MAX_YAML:
            raise BoundaryError()
        yaml_lib, loader, _ = engine._codec()
        parsed = yaml_lib.load(yaml_text, Loader=loader)
        scope_check(parsed)
        preview_id = identity(request["previewId"])
        attempt = job / preview_id
        attempt.mkdir(mode=0o700)
        project = attempt / "project"
        project.mkdir(mode=0o700)
        copy_project(base, project)
        # Replace only this call's private candidate, never the original/base YAML.
        candidate = project / "project.yml"
        candidate.write_text(yaml_text, encoding="utf-8", newline="\n")
        nodes = [yaml_lib.compose(yaml_text, Loader=loader)]
        while nodes:
            node = nodes.pop()
            if (
                isinstance(node, yaml_lib.ScalarNode)
                and node.tag == "tag:yaml.org,2002:float"
            ):
                expected = Decimal(node.value.replace("_", ""))
                if not expected.is_finite() or expected != Decimal(
                    str(float(expected))
                ):
                    raise BoundaryError("NUMERIC_PRECISION_UNSUPPORTED")
            elif isinstance(node, yaml_lib.MappingNode):
                nodes.extend(child for pair in node.value for child in pair)
            elif isinstance(node, yaml_lib.SequenceNode):
                nodes.extend(node.value)
        refs = [parsed]
        while refs:
            value = refs.pop()
            if isinstance(value, engine.JsonRef):
                raw = read_regular(engine._local_file(project, value.path, set()))
                exact_json_numbers(raw, engine._json_load(raw))
            elif isinstance(value, dict):
                refs.extend(value.values())
            elif isinstance(value, list):
                refs.extend(value)
        compiled = engine.compile_flow_yaml(candidate, request["format"])
        scope_check(compiled.document)
        if compiled.errors:
            return {
                "ok": True,
                "valid": False,
                "errorCount": len(compiled.errors),
                "errors": [e.split(": ", 1)[0][:256] for e in compiled.errors[:20]],
                "nativeExecutionVerified": False,
            }
        output = attempt / ("preview." + request["format"])
        result = engine.build_flow_package(candidate, output)
        payload = read_regular(output)
        actual = engine._source_entries(NativeBuffer(payload))
        expected_names = set(compiled.document) | set(compiled.files)
        if (
            set(actual) != expected_names
            or read_regular(candidate, MAX_YAML) != yaml_text.encode()
        ):
            raise BoundaryError("SOURCE_CHANGED")
        if any(
            engine._json_load(actual[name]) != value
            for name, value in compiled.document.items()
        ) or any(actual[name] != value for name, value in compiled.files.items()):
            raise BoundaryError("SOURCE_CHANGED")
        fingerprint = manifest(project)[0]
        receipt = {
            "format": request["format"],
            "yamlSha256": digest(yaml_text.encode()),
            "previewSha256": digest(payload),
            "projectSha256": fingerprint,
            "baseSha256": request["projectSha256"],
            "summary": summary(compiled.document),
        }
        with (attempt / "receipt.json").open("x", encoding="utf-8") as stream:
            json.dump(receipt, stream)
        return {
            "ok": True,
            "valid": True,
            "previewId": preview_id,
            "previewSha256": receipt["previewSha256"],
            "bytes": result["bytes"],
            "nodeCount": result["nodeCount"],
            "attachmentCount": result["attachmentCount"],
            "summary": receipt["summary"],
            "nativeExecutionVerified": False,
        }
    if operation == "generate":
        attempt = job / identity(request["previewId"])
        receipt = json.loads(read_regular(attempt / "receipt.json", MAX_YAML))
        if (
            receipt["previewSha256"] != request["previewSha256"]
            or receipt["yamlSha256"] != request["yamlSha256"]
            or receipt["format"] != request["format"]
            or receipt["baseSha256"] != request["projectSha256"]
            or manifest(attempt / "project")[0] != receipt["projectSha256"]
        ):
            raise BoundaryError("STALE_PREVIEW")
        payload = read_regular(attempt / ("preview." + receipt["format"]))
        if digest(payload) != receipt["previewSha256"]:
            raise BoundaryError("STALE_PREVIEW")
        target = attempt / ("generated." + receipt["format"])
        no_links(target)
        engine._publish_bytes(target, payload, overwrite=False)
        if digest(read_regular(target)) != receipt["previewSha256"]:
            raise BoundaryError()
        return {
            "ok": True,
            "valid": True,
            "path": target.relative_to(ROOT).as_posix(),
            "sha256": digest(payload),
            "bytes": len(payload),
            "summary": receipt["summary"],
            "nativeExecutionVerified": False,
        }
    raise BoundaryError()


def main():
    try:
        raw = sys.stdin.buffer.read(48 * 1024 * 1024 + 1)
        if len(raw) > 48 * 1024 * 1024:
            raise BoundaryError()
        result = execute(json.loads(raw))
        encoded = json.dumps(result, ensure_ascii=False)
        if len(encoded.encode()) > 2 * MAX_YAML:
            raise BoundaryError()
        print(encoded)
        return 0
    except Exception as error:
        code = (
            error.code
            if isinstance(error, BoundaryError)
            else "WORKSPACE_PATH_TOO_LONG"
            if getattr(error, "winerror", None) == 206
            else "COMPILATION_UNAVAILABLE"
        )
        print(
            json.dumps(
                {
                    "ok": False,
                    "code": code,
                    "message": "The native/YAML project could not be safely prepared, validated or generated. No publish or flow execution was attempted.",
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
