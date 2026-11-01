"""Typed, lossless metadata models for YAML authoring.

The JSON Schema remains the format authority. These models expose stable fields
to Python callers and reject coercion. Unknown private fields remain JSON data.
"""
from __future__ import annotations

from typing import Annotated, Literal, NewType

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StringConstraints

FlowId = NewType("FlowId", str)
NodeType = NewType("NodeType", str)
UuidText = Annotated[FlowId, StringConstraints(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")]
VersionedType = Annotated[NodeType, StringConstraints(pattern=r"^\.v[0-9]+(_[0-9]+)*\.[A-Za-z0-9_]+$")]
PackageType = Literal["tfl", "tflx"]


class ExtensibleMetadata(BaseModel):
    model_config = ConfigDict(
        strict=True, extra="allow", validate_assignment=True, populate_by_name=True,
        revalidate_instances="always", hide_input_in_errors=True,
    )
    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)


class FlowEdge(ExtensibleMetadata):
    next_node_id: UuidText = Field(alias="nextNodeId")
    namespace: str | None = None
    next_namespace: str | None = Field(default=None, alias="nextNamespace")


class ConnectionAttributes(ExtensibleMetadata):
    connection_class: str | None = Field(default=None, alias="class")
    filename: str | None = None


class FlowConnection(ExtensibleMetadata):
    id: UuidText | None = None
    connection_type: str | None = Field(default=None, alias="connectionType")
    name: str | None = None
    is_packaged: bool | None = Field(default=None, alias="isPackaged")
    connection_attributes: ConnectionAttributes | None = Field(default=None, alias="connectionAttributes")


class DataConnection(ExtensibleMetadata):
    id: str | None = None
    connection_type: str | None = Field(default=None, alias="connectionType")
    name: str | None = None
    connection_attributes: ConnectionAttributes | None = Field(default=None, alias="connectionAttributes")


class NamespaceBinding(ExtensibleMetadata):
    node_id: UuidText | None = Field(default=None, alias="nodeId")
    namespace: str | None = None


class FlowField(ExtensibleMetadata):
    name: str | None = None
    data_type: str | None = Field(default=None, alias="dataType")


class FlowNode(ExtensibleMetadata):
    id: UuidText
    node_type: VersionedType = Field(alias="nodeType")
    # Observed categories include superNode and remain open to private variants.
    base_type: str = Field(alias="baseType")
    name: str | None = None
    description: str | None = None
    serialize: bool | None = None
    next_nodes: list[FlowEdge] | None = Field(default=None, alias="nextNodes")
    connection_id: str | None = Field(default=None, alias="connectionId")
    connection_attributes: ConnectionAttributes | None = Field(default=None, alias="connectionAttributes")
    loom_container: FlowGraph | None = Field(default=None, alias="loomContainer")
    namespaces_to_input: dict[str, NamespaceBinding] | None = Field(default=None, alias="namespacesToInput")
    namespaces_to_output: dict[str, NamespaceBinding] | None = Field(default=None, alias="namespacesToOutput")
    column_name: str | None = Field(default=None, alias="columnName")
    expression: str | None = None
    hyper_output_file: str | None = Field(default=None, alias="hyperOutputFile")
    tds_output: str | None = Field(default=None, alias="tdsOutput")
    fields: dict[str, FlowField] | list[FlowField] | None = None


class FlowGraph(ExtensibleMetadata):
    nodes: dict[UuidText, FlowNode]
    initial_nodes: list[UuidText] | None = Field(default=None, alias="initialNodes")
    connections: dict[UuidText, FlowConnection] | None = None
    connection_ids: list[UuidText] | None = Field(default=None, alias="connectionIds")
    data_connections: dict[str, DataConnection] | None = Field(default=None, alias="dataConnections")
    data_connection_ids: list[str] | None = Field(default=None, alias="dataConnectionIds")
    major_version: int | None = Field(default=None, alias="majorVersion")
    minor_version: int | None = Field(default=None, alias="minorVersion")
    document_id: str | None = Field(default=None, alias="documentId")
    obfuscator_id: str | None = Field(default=None, alias="obfuscatorId")
    parameters: dict[str, JsonValue] | None = None
    extensibility: dict[str, JsonValue] | None = None
    selection: JsonValue = None


class DisplayPoint(ExtensibleMetadata):
    x: int | float
    y: int | float


class DisplaySize(ExtensibleMetadata):
    width: int | float
    height: int | float


class NodeDisplaySettings(ExtensibleMetadata):
    position: DisplayPoint | None = None
    size: DisplaySize | None = None


class FlowDisplaySettings(ExtensibleMetadata):
    flow_node_display_settings: dict[UuidText, NodeDisplaySettings] | None = Field(default=None, alias="flowNodeDisplaySettings")


class DisplaySettings(ExtensibleMetadata):
    major_version: int | None = Field(default=None, alias="majorVersion")
    minor_version: int | None = Field(default=None, alias="minorVersion")
    flow_display_settings: FlowDisplaySettings | None = Field(default=None, alias="flowDisplaySettings")


class MaestroMetadata(ExtensibleMetadata):
    major_version: int | None = Field(default=None, alias="majorVersion")
    minor_version: int | None = Field(default=None, alias="minorVersion")
    flow_entry_name: Literal["flow"] = Field(alias="flowEntryName")
    display_settings_entry_name: Literal["displaySettings"] = Field(alias="displaySettingsEntryName")
    is_packaged_maestro_document: bool = Field(alias="isPackagedMaestroDocument")


class FlowDocument(ExtensibleMetadata):
    flow: FlowGraph
    display_settings: DisplaySettings = Field(alias="displaySettings")
    maestro_metadata: MaestroMetadata = Field(alias="maestroMetadata")

    def to_document(self) -> dict[str, JsonValue]:
        """Preserve explicit nulls, missing properties and private JSON fields."""
        return self.model_dump(mode="json", by_alias=True, exclude_unset=True)


class ValidationResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    valid: bool
    errors: list[str]
    warnings: list[str]
    node_count: int = Field(default=0, alias="nodeCount")
    attachment_count: int = Field(default=0, alias="attachmentCount")


# Resolve the graph/node recursive contract explicitly for callers and bundlers.
FlowNode.model_rebuild()
FlowGraph.model_rebuild()
