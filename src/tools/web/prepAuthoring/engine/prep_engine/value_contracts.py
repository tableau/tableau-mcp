"""Read generation values and their provenance from the canonical JSON/YAML schema."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import re
from typing import Any


@dataclass(frozen=True)
class SchemaValues:
    schema: dict[str, Any]

    def definition(self, name: str) -> dict[str, Any]:
        value = self._resolve("#/$defs/" + name)
        if not isinstance(value, dict):
            raise ValueError("Schema definition must be an object")
        return value

    def _resolve(self, pointer: str) -> Any:
        if not pointer.startswith("#/"):
            raise ValueError("Only local schema references are supported")
        value: Any = self.schema
        for token in pointer[2:].split("/"):
            value = value[token.replace("~1", "/").replace("~0", "~")]
        return value

    def expand(self, shape: dict[str, Any]) -> dict[str, Any]:
        if "$ref" not in shape:
            return shape
        target = self._resolve(shape["$ref"])
        if not isinstance(target, dict) or "$ref" in target:
            raise ValueError("Unsupported chained schema reference")
        return {**target, **{key: value for key, value in shape.items() if key != "$ref"}}

    def template(self, definition: str) -> dict[str, Any]:
        """Copy only declared const/default values; never infer private values."""
        def read(shape: dict[str, Any]) -> tuple[bool, Any]:
            referenced = "$ref" in shape
            shape = self.expand(shape)
            if "const" in shape:
                return True, deepcopy(shape["const"])
            if "default" in shape:
                return True, deepcopy(shape["default"])
            if referenced:
                return False, None
            values: dict[str, Any] = {}
            for key, child in shape.get("properties", {}).items():
                present, value = read(child)
                if present:
                    values[key] = value
            return bool(values), values
        _, values = read(self.definition(definition))
        if not isinstance(values, dict):
            raise ValueError("Generation template must be an object")
        return values

    def apply_defaults(self, target: dict[str, Any], definition: str) -> None:
        for key, value in self.template(definition).items():
            target.setdefault(key, value)

    def node_variant(self, node_type: Any) -> str | None:
        if not isinstance(node_type, str):
            return None
        variants: dict[str, Any] = self.schema["$defs"]["nodeVariants"]
        for name, shape in variants.items():
            discriminator = shape["properties"]["nodeType"]
            if discriminator.get("const") == node_type or (
                "pattern" in discriminator and re.fullmatch(discriminator["pattern"], node_type)
            ):
                return "nodeVariants/" + name
        return None

    def describe(self, definition: str | None = None) -> dict[str, Any]:
        """Describe every declared key, distinguishing native proof from policy."""
        records: list[dict[str, Any]] = []
        start = self.definition(definition) if definition else self.schema
        prefix = "#/$defs/" + definition if definition else "#"
        constraint_keys = ("type", "const", "enum", "pattern", "format", "items", "additionalProperties", "required", "minimum", "maximum",
                           "minItems", "maxItems", "minLength", "maxLength", "default", "examples",
                           "x-value-evidence", "x-native-known-values", "x-authoring-generated")

        def visit(value: Any, path: str, inherited_evidence: Any = None) -> None:
            if isinstance(value, dict):
                evidence = value.get("x-value-evidence", inherited_evidence)
                for key, shape in value.get("properties", {}).items():
                    expanded = self.expand(shape)
                    record: dict[str, Any] = {
                        "key": key, "schemaPath": path + "/properties/" + key,
                        **{name: deepcopy(expanded[name]) for name in constraint_keys if name in expanded},
                    }
                    if "x-value-evidence" not in record:
                        record["x-value-evidence"] = deepcopy(evidence) if evidence else {"kind": "unverified-value-domain"}
                    if "anyOf" in expanded:
                        record["alternatives"] = [deepcopy(self.expand(item)) for item in expanded["anyOf"]]
                    records.append(record)
                for key, child in value.items():
                    if key not in ("default", "examples", "x-value-evidence", "x-native-known-values"):
                        visit(child, path + "/" + key.replace("~", "~0").replace("/", "~1"), evidence)
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    visit(child, path + "/" + str(index), inherited_evidence)

        visit(start, prefix)
        return {"format": "tableau-prep-values/v1", "definition": definition,
                "contract": {key: deepcopy(start[key]) for key in constraint_keys if key in start}, "properties": records,
                "notes": ["Static generation values use const/default; IDs and references use declared generation strategies.",
                          "Native XML value domains are distinct from flow JSON domains.",
                          "Known native values and examples are not exhaustive enums unless enum is explicit."]}
