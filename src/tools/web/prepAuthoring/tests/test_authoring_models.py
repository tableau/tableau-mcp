from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from prep_engine.authoring import compile_flow_yaml, new_flow_yaml
from prep_engine.authoring_models import FlowDocument, FlowEdge, FlowId, FlowNode, NodeType

NODE_ID = "15cf7ca0-8352-4afe-9bf1-d5dd35a4600f"


def test_compilation_uses_typed_graph_and_preserves_json(tmp_path: Path) -> None:
    source = tmp_path / "sales.yml"
    new_flow_yaml(source, "tflx")
    compiled = compile_flow_yaml(source, "tflx")
    assert not compiled.errors, compiled.errors
    model = compiled.model
    assert isinstance(model, FlowDocument)
    assert model.to_document() == compiled.document
    assert all(isinstance(node, FlowNode) for node in model.flow.nodes.values())
    assert all(isinstance(edge, FlowEdge) for node in model.flow.nodes.values() for edge in node.next_nodes or [])
    calculation = next(node for node in model.flow.nodes.values() if node.expression)
    calculation.expression = "[Sales] * 1.3"
    assert any(node.get("expression") == "[Sales] * 1.3" for node in model.to_document()["flow"]["nodes"].values())
    with pytest.raises(ValidationError):
        setattr(calculation, "expression", 123)


@pytest.mark.parametrize("field,value", [("id", "bad-id"), ("nodeType", "AddColumn"), ("baseType", 123), ("serialize", "false")])
def test_model_rejects_wrong_field_types_without_coercion(field: str, value: object) -> None:
    raw = {"id": NODE_ID, "nodeType": ".v1.AddColumn", "baseType": "transform", field: value}
    with pytest.raises(ValidationError):
        FlowNode.model_validate(raw)


def test_typed_metadata_keeps_missing_null_and_future_fields_distinct() -> None:
    raw = {"id": NODE_ID, "nodeType": ".v12_3.FutureOperation", "baseType": "futureCategory",
           "description": None, "privateExtension": {"future": [True, False, None, "on", 1]}}
    model = FlowNode.model_validate(raw)
    assert model.model_dump(mode="json", by_alias=True, exclude_unset=True) == raw
    assert "name" not in model.model_fields_set
    assert "description" in model.model_fields_set
    typed_id: FlowId = model.id
    typed_type: NodeType = model.node_type
    assert typed_id == NODE_ID and typed_type == ".v12_3.FutureOperation"


def test_typed_nested_graph_is_recursive() -> None:
    node = FlowNode.model_validate({
        "id": NODE_ID, "nodeType": ".v1.Container", "baseType": "container",
        "loomContainer": {"nodes": {NODE_ID: {"id": NODE_ID, "nodeType": ".v1.AddColumn", "baseType": "transform"}}},
    })
    assert node.loom_container is not None
    assert isinstance(node.loom_container.nodes[FlowId(NODE_ID)], FlowNode)
