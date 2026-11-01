from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import uuid
import zipfile

import pytest

from prep_engine import authoring as engine
from prep_engine.authoring import (
    build_flow_package,
    compile_flow_yaml,
    export_flow_yaml,
)
import runner

MINIMAL = """format: tableau-prep-flow/v1
namespace: 15cf7ca0-8352-4afe-9bf1-d5dd35a4600f
flow:
  nodes:
    calculate:
      nodeType: .v1.AddColumn
      expression: '1'
"""


def fingerprint(raw):
    return hashlib.sha256(raw).hexdigest()


def prepare(tmp_path, kind="tflx"):
    root = tmp_path.resolve()
    runner.ROOT = root
    request = {"workspace": str(root), "jobId": str(uuid.uuid4()), "format": kind}
    result = runner.execute(
        {**request, "operation": "prepare", "source": {"type": "new"}}
    )
    assert result["ok"] and result["valid"]
    return {**request, "projectSha256": result["projectSha256"]}, result


def preview(request, yaml):
    return runner.execute(
        {
            **request,
            "operation": "preview",
            "previewId": str(uuid.uuid4()),
            "yaml": yaml,
        }
    )


def generate(request, candidate, yaml):
    return runner.execute(
        {
            **request,
            "operation": "generate",
            "previewId": candidate["previewId"],
            "previewSha256": candidate["previewSha256"],
            "yamlSha256": fingerprint(yaml.encode()),
        }
    )


def metadata(path):
    with zipfile.ZipFile(path) as archive:
        return {
            n: json.loads(archive.read(n))
            if n in engine.KNOWN_ENTRIES
            else archive.read(n)
            for n in archive.namelist()
            if not n.endswith("/")
        }


def native(path, document, extras=None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in document.items():
            archive.writestr(name, json.dumps(value))
        for name, raw in (extras or {}).items():
            archive.writestr(name, raw)


def test_migrated_sources_match_the_recorded_snapshots():
    root = Path(__file__).resolve().parents[1] / "engine"
    migration = json.loads((root / "MIGRATION.json").read_text(encoding="utf-8"))
    assert len(migration["files"]) == 6
    for item in migration["files"]:
        assert (
            fingerprint((root / item["destination"]).read_bytes())
            == item["canonicalLfSha256"]
        )
    for item in migration["portedTests"]:
        assert (
            fingerprint((root / item["destination"]).read_bytes())
            == item["canonicalLfSha256"]
        )


@pytest.mark.parametrize("kind", ["tfl", "tflx"])
def test_new_compact_yaml_edit_preview_and_exact_generated_bytes(tmp_path, kind):
    request, prepared = prepare(tmp_path, kind)
    yaml = prepared["yaml"].replace("[Sales] * 1.1", "[Sales] * 1.2")
    assert "!id" in yaml and "namespace:" in yaml
    candidate = preview(request, yaml)
    assert candidate["valid"] and candidate["nativeExecutionVerified"] is False
    result = generate(request, candidate, yaml)
    output = tmp_path / result["path"]
    assert (
        fingerprint(output.read_bytes())
        == candidate["previewSha256"]
        == result["sha256"]
    )
    document = metadata(output)
    assert any(
        n.get("expression") == "[Sales] * 1.2"
        for n in document["flow"]["nodes"].values()
    )
    assert document["maestroMetadata"]["isPackagedMaestroDocument"] is (kind == "tflx")
    if kind == "tflx":
        assert b"Region,Sales\nEast,100\nWest,200\n" in document.values()


def test_externalized_values_and_unknown_metadata_roundtrip_without_loss(tmp_path):
    source = tmp_path / "raw.yml"
    source.write_text(MINIMAL, encoding="utf-8")
    compiled = compile_flow_yaml(source)
    assert not compiled.errors
    node = next(iter(compiled.document["flow"]["nodes"].values()))
    node["values"] = {"group": [f"item-{i}" for i in range(1000)]}
    node["futureExtension"] = {"settings": [1, False, None, "on"]}
    original = tmp_path / "original.tfl"
    native(original, compiled.document, {"opaque.bin": b"\x00unchanged\xff"})
    exported = tmp_path / "compact.yml"
    export_flow_yaml(original, exported)
    text = exported.read_text(encoding="utf-8")
    assert "!id" in text and "!include" in text and "item-999" not in text
    rebuilt = tmp_path / "rebuilt.tfl"
    build_flow_package(exported, rebuilt)
    assert metadata(original) == metadata(rebuilt)


@pytest.mark.parametrize(
    "invalid",
    [
        "!!python/object/apply:os.system [whoami]",
        "format: one\nformat: two\n",
        "a: &a [*a]",
    ],
)
def test_unsafe_yaml_is_rejected_without_native_output(tmp_path, invalid, monkeypatch):
    request, _ = prepare(tmp_path)

    def command(*args):
        pytest.fail("YAML executed a command")

    monkeypatch.setattr(os, "system", command)
    with pytest.raises(Exception):
        preview(request, invalid)
    assert not list(tmp_path.rglob("preview.tflx"))
    assert not list(tmp_path.rglob("generated.tflx"))


def test_source_resource_change_blocks_preview(tmp_path):
    request, prepared = prepare(tmp_path)
    resource = (
        tmp_path
        / ".tableau-prep-mcp"
        / request["jobId"]
        / "base/project.resources/sales.csv"
    )
    resource.write_bytes(b"changed")
    with pytest.raises(runner.BoundaryError) as failure:
        preview(request, prepared["yaml"])
    assert failure.value.code == "SOURCE_CHANGED"


@pytest.mark.parametrize("changed", ["project", "archive"])
def test_changed_preview_or_resource_blocks_generation(tmp_path, changed):
    request, prepared = prepare(tmp_path)
    candidate = preview(request, prepared["yaml"])
    attempt = tmp_path / ".tableau-prep-mcp" / request["jobId"] / candidate["previewId"]
    path = attempt / (
        "project/project.resources/sales.csv"
        if changed == "project"
        else "preview.tflx"
    )
    path.write_bytes(b"changed")
    with pytest.raises(runner.BoundaryError) as failure:
        generate(request, candidate, prepared["yaml"])
    assert failure.value.code == "STALE_PREVIEW"
    assert not (attempt / "generated.tflx").exists()


def test_existing_output_is_preserved(tmp_path):
    request, prepared = prepare(tmp_path)
    candidate = preview(request, prepared["yaml"])
    target = (
        tmp_path
        / ".tableau-prep-mcp"
        / request["jobId"]
        / candidate["previewId"]
        / "generated.tflx"
    )
    target.write_bytes(b"KEEP")
    with pytest.raises(FileExistsError):
        generate(request, candidate, prepared["yaml"])
    assert target.read_bytes() == b"KEEP"


def test_project_includes_cannot_read_parent_resources(tmp_path):
    request, prepared = prepare(tmp_path)
    text = prepared["yaml"].replace("project.resources/sales.csv", "../outside.csv")
    (tmp_path / "outside.csv").write_bytes(b"PRIVATE_OUTSIDE")
    with pytest.raises(Exception):
        preview(request, text)
    assert not list(tmp_path.rglob("preview.tflx"))


@pytest.mark.parametrize(
    "attribute,value,code",
    [
        ("class", "postgres", "DATABASE_PROVIDER_UNSUPPORTED"),
        ("password", "FAKE_SECRET", "CREDENTIAL_METADATA_UNSUPPORTED"),
    ],
)
def test_provider_settings_and_inline_credentials_are_not_exported(
    tmp_path, attribute, value, code
):
    source = tmp_path / "raw.yml"
    source.write_text(MINIMAL, encoding="utf-8")
    document = compile_flow_yaml(source).document
    document["flow"]["connections"] = {
        "x": {"connectionAttributes": {attribute: value}}
    }
    package = tmp_path / "private.tflx"
    native(package, document)
    request = {
        "workspace": str(tmp_path.resolve()),
        "jobId": str(uuid.uuid4()),
        "format": "tflx",
        "operation": "prepare",
        "source": {
            "type": "download",
            "base64": base64.b64encode(package.read_bytes()).decode(),
        },
    }
    with pytest.raises(runner.BoundaryError) as failure:
        runner.execute(request)
    assert failure.value.code == code
    assert not list((tmp_path / ".tableau-prep-mcp").rglob("original.tflx"))
    assert not list((tmp_path / ".tableau-prep-mcp").rglob("project.yml"))


def test_hardlinked_local_source_is_rejected(tmp_path):
    request, prepared = prepare(tmp_path)
    candidate = preview(request, prepared["yaml"])
    generated = generate(request, candidate, prepared["yaml"])
    alias = tmp_path / "alias.tflx"
    os.link(tmp_path / generated["path"], alias)
    with pytest.raises(runner.BoundaryError):
        runner.execute(
            {
                "workspace": str(tmp_path.resolve()),
                "jobId": str(uuid.uuid4()),
                "format": "tflx",
                "operation": "prepare",
                "source": {"type": "local", "path": "alias.tflx"},
            }
        )


def test_selected_json_resource_can_replace_an_external_value_list(tmp_path):
    (tmp_path / "choices.json").write_text('["A", "B"]', encoding="utf-8")
    request = {
        "workspace": str(tmp_path.resolve()),
        "jobId": str(uuid.uuid4()),
        "format": "tflx",
    }
    prepared = runner.execute(
        {
            **request,
            "operation": "prepare",
            "source": {"type": "new"},
            "resources": ["choices.json"],
        }
    )
    assert prepared["resources"][0]["path"] == "user-resources/choices.json"
    yaml = prepared["yaml"]
    # Append a future root extension with a declarative JSON include, preserving
    # the native graph and all opaque source resources.
    yaml = yaml.replace(
        "flow:\n", "flow:\n  selectedValues: !include user-resources/choices.json\n", 1
    )
    candidate = preview({**request, "projectSha256": prepared["projectSha256"]}, yaml)
    assert candidate["valid"]


def test_numeric_precision_loss_is_rejected_instead_of_silently_rounding(tmp_path):
    request, prepared = prepare(tmp_path)
    yaml = prepared["yaml"].replace(
        "flow:\n", "flow:\n  preciseExtension: 0.1234567890123456789012345\n", 1
    )
    with pytest.raises(runner.BoundaryError) as failure:
        preview(request, yaml)
    assert failure.value.code == "NUMERIC_PRECISION_UNSUPPORTED"
    with pytest.raises(runner.BoundaryError):
        runner.exact_json_numbers(
            b'{"x":0.1234567890123456789012345}', {"x": 0.12345678901234568}
        )


CORPUS = (
    Path(os.environ["PREP_REFERENCE_CORPUS"])
    if os.environ.get("PREP_REFERENCE_CORPUS")
    else None
)
PACKAGES = (
    sorted(p for p in CORPUS.iterdir() if p.suffix.lower() in {".tfl", ".tflx"})
    if CORPUS
    else []
)


@pytest.mark.parametrize("package", PACKAGES, ids=lambda p: p.name)
def test_reference_native_corpus_roundtrip(tmp_path, package):
    """Read-only external corpus: compare all metadata and opaque attachments."""
    exported = tmp_path / "editable.yml"
    export_flow_yaml(package, exported)
    rebuilt = tmp_path / ("rebuilt" + package.suffix)
    result = build_flow_package(exported, rebuilt)
    assert result["valid"]
    assert metadata(package) == metadata(rebuilt)


def test_owner_context_is_distinct_from_connection_authentication():
    runner.scope_check(
        {
            "ownerUserId": "11111111-1111-4111-8111-111111111111",
            "connectionAttributes": {
                "class": "sqlproxy",
                "server": "https://tableau.invalid",
            },
        }
    )
    with pytest.raises(runner.BoundaryError):
        runner.scope_check(
            {
                "connectionAttributes": {
                    "class": "sqlproxy",
                    "username": "DUMMY_PRINCIPAL",
                }
            }
        )
    with pytest.raises(runner.BoundaryError):
        runner.scope_check({"server": "https://user:FAKE_PASSWORD@tableau.invalid"})
