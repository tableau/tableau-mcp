"""Pure credential classification shared by authoring, reuse and LLM boundaries."""
from __future__ import annotations

import re
from typing import Any, Literal

CredentialKind = Literal["secret", "principal", "locator", "metadata", "none"]

# Tableau's extracted connector policy currently marks these names secure. A
# regression test compares this set with every ``secure: true`` native field so
# product updates fail closed until the policy is reviewed.
NATIVE_SECURE_ATTRIBUTE_KEYS = frozenset({"password", "priv-key-file-pwd"})
CONNECTION_ATTRIBUTE_CONTAINERS = frozenset(
    {"attributes", "connectionAttributes", "modifiedConnectionAttributes"}
)
AUTH_VALUE_CONTAINERS = CONNECTION_ATTRIBUTE_CONTAINERS | frozenset(
    {"headers", "setupParameters", "executionParameters"}
)

# These patterns are also embedded into JSON Schema. Keep them ECMAScript
# compatible and case-insensitive through apply_credential_policy's expansion.
AUTH_ATTRIBUTE = re.compile(
    r"password|passwd|passphrase|secret|credential(?!s?[-_.:]?dialog(?:$|[-_.:]))s?|keychain|"
    r"authorization(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|bearer|"
    r"(?:^|[-_.:])(?:auth|cookie|signature)$|"
    r"auth[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|"
    r"(?:account|access|subscription|functions?)[-_.:]?key|shared[-_.:]?access[-_.:]?signature|"
    r"(?:^|[-_.:])pwd(?:$|[-_.:])|api[-_.:]?key|client[-_.:]?secret|"
    r"service[-_.:]?account[-_.:]?json|"
    r"ssl[-_.:]?client[-_.:]?key(?![-_.:]?(?:file|path)(?:$|[-_.:]))|"
    r"personal[-_.:]?access[-_.:]?token|"
    r"(?:authentication|authenticity|api|oauth|sas|xsrf)[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|"
    r"(?:access|refresh|id|session|security)[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|"
    r"(?:^|[-_.:])token(?:$|[-_.:](?!(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:])))|"
    r"(?:private|priv)[-_.:]?key(?![-_.:]?(?:file|path)(?:$|[-_.:]))|"
    r"client[-_.:]?id$|access[-_.:]?key[-_.:]?id$|(?:^|[-_.:])key[-_.:]?id$|"
    r"username(?:[-_.:]?alias)?$|userid$|user[-_.:]?(?:name|id|luid|custom)$|"
    r"viewer[-_.:]?id$|device[-_.:]?id$|authenticated[-_.:]?user$|"
    r"proxy[-_.:]?(?:user|uid)$|(?:^|[-_.:])(?:user|uid)$",
    re.I,
)
INLINE_AUTH = re.compile(
    r"(?:^|[;?&#,\s{[(])['\"]?(?:pwd|password|passwd|passphrase|token|access[-_]?token|"
    r"refresh[-_]?token|id[-_]?token|session[-_]?token|security[-_]?token|"
    r"authentication[-_]?token|api[-_]?token|oauth[-_]?token|sas[-_]?token|"
    r"personal[-_]?access[-_]?token|client[-_]?secret|credential|"
    r"api[-_]?key|x[-_]?api[-_]?key|private[-_]?key|authorization|"
    r"service[-_]?account[-_]?json|ssl[-_]?client[-_]?key|"
    r"account[-_]?key|secret[-_]?access[-_]?key|shared[-_]?access[-_]?signature|"
    r"[A-Za-z0-9]*(?:access[-_]?key[-_]?id|account[-_]?key|secret[-_]?access[-_]?key|"
    r"session[-_]?token|security[-_]?token|shared[-_]?access[-_]?signature)|"
    r"x[-_]?tableau[-_]?auth|cookie|set[-_]?cookie|"
    r"user(?:name|[-_\s]?id)?|uid|signature|sig)\s*['\"]?\s*[:=]|"
    r"(?:^|[\s;,])(?:authorization\s*[:=]\s*)?(?:basic|bearer)\s+[^\s;,]+|"
    r"://[^/\s?#@]*@|"
    r"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
    re.I,
)
INLINE_PAIR_AUTH = re.compile(
    r"(?:^|[;?&#,\s{[(])['\"]?[A-Za-z0-9_.:-]{0,256}(?:"
    r"password|passwd|passphrase|secret|credential|keychain|bearer|"
    r"authorization(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?=['\"]?\s*[:=]|[-_.:]))|"
    r"(?:^|[-_.:])(?:auth|cookie|signature)(?=['\"]?\s*[:=])|"
    r"(?:account|access|subscription|functions?)[-_.:]?key|shared[-_.:]?access[-_.:]?signature|"
    r"(?:^|[-_.:])pwd(?:$|[-_.:])|api[-_.:]?key|client[-_.:]?secret|"
    r"service[-_.:]?account[-_.:]?json|"
    r"ssl[-_.:]?client[-_.:]?key(?![-_.:]?(?:file|path)(?=['\"]?\s*[:=]|[-_.:]))|"
    r"personal[-_.:]?access[-_.:]?token|"
    r"(?:authentication|authenticity|api|oauth|sas|xsrf)[-_.:]?token"
    r"(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?=['\"]?\s*[:=]|[-_.:]))|"
    r"(?:access|refresh|id|session|security)[-_.:]?token"
    r"(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?=['\"]?\s*[:=]|[-_.:]))|"
    r"(?:^|[-_.:])token(?=['\"]?\s*[:=]|[-_.:]"
    r"(?!(?:endpoint|url|uri|name|type|mode)(?=['\"]?\s*[:=]|[-_.:])))|"
    r"(?:private|priv)[-_.:]?key(?![-_.:]?(?:file|path)(?=['\"]?\s*[:=]|[-_.:]))|"
    r"client[-_.:]?id|access[-_.:]?key[-_.:]?id|(?:^|[-_.:])key[-_.:]?id|"
    r"username(?:[-_.:]?alias)?|userid|user[-_.:]?(?:name|id|luid|custom)|"
    r"viewer[-_.:]?id|device[-_.:]?id|authenticated[-_.:]?user|"
    r"proxy[-_.:]?(?:user|uid)|(?:^|[-_.:])(?:user|uid)(?:$|[-_.:])"
    r")[A-Za-z0-9_.:-]{0,256}['\"]?\s*[:=]",
    re.I,
)


def _parts(name: str) -> tuple[str, ...]:
    separated = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    return tuple(part.lower() for part in re.split(r"[^A-Za-z0-9]+", separated) if part)


def credential_kind(name: object, *, native_secure: bool = False) -> CredentialKind:
    """Classify a connection setting without inspecting or returning its value."""
    if not isinstance(name, str) or not name:
        return "none"
    lowered = name.lower()
    if native_secure or lowered in NATIVE_SECURE_ATTRIBUTE_KEYS:
        return "secret"
    parts = _parts(name)
    if not parts:
        return "none"

    # File locations and endpoint/mode labels are authentication metadata, not
    # credential values. A trailing password/passphrase still wins below.
    locator = lowered == "sslfile" or (
        parts[-1] in {"file", "path"}
        and (
            any(
                parts[index] in {"private", "priv"}
                and index + 2 < len(parts)
                and parts[index + 1] == "key"
                and parts[index + 2] in {"file", "path"}
                for index in range(len(parts))
            )
            or parts[-4:] in {
                ("ssl", "client", "key", "file"),
                ("ssl", "client", "key", "path"),
                ("ssl", "client", "cert", "file"),
            }
            or parts[-4:] == ("service", "account", "file", "path")
            or parts[-2:] == ("certificate", "file")
        )
    )
    if locator and not set(parts) & {"password", "passwd", "pwd", "passphrase", "secret"}:
        return "locator"
    if (
        (
            "token" in parts
            and parts[-1] in {"endpoint", "url", "uri", "type", "mode", "name"}
            and not ({"personal", "access"} <= set(parts))
        )
        or lowered in {"oauth", "authentication", "authentication_mode", "authentication-mode"}
        or (
            set(parts) & {"auth", "authentication", "authorization"}
            and parts[-1] in {"endpoint", "url", "uri", "type", "mode", "name"}
        )
        or (parts[0] == "sas" and parts[-1] in {"url", "uri"})
        or parts == ("workgroup", "credentials", "dialog")
    ):
        return "metadata"

    if AUTH_ATTRIBUTE.search(name) is None:
        return "none"
    if parts[-1] in {"username", "userid", "uid", "user", "viewerid"} or parts[-2:] in {
        ("user", "name"),
        ("user", "id"),
        ("user", "luid"),
        ("user", "custom"),
        ("client", "id"),
        ("key", "id"),
        ("viewer", "id"),
        ("device", "id"),
        ("authenticated", "user"),
        ("proxy", "user"),
        ("proxy", "uid"),
        ("username", "alias"),
        ("credential", "id"),
    } or parts[-3:] == ("access", "key", "id"):
        return "principal"
    return "secret"


def credential_key(name: object) -> bool:
    return credential_kind(name) in {"secret", "principal"}


def contains_inline_credential(value: object) -> bool:
    if not isinstance(value, str):
        return False
    return INLINE_AUTH.search(value) is not None or INLINE_PAIR_AUTH.search(value) is not None


def connection_scope_has_credentials(value: Any, *, limit: int = 100000) -> bool:
    """Inspect one credential-bearing container, including nested mappings."""
    pending, count = [value], 0
    while pending:
        current = pending.pop()
        count += 1
        if count > limit:
            # Oversized authentication metadata is not safe to accept.
            return True
        if isinstance(current, dict):
            for key, item in current.items():
                if credential_key(key) and item not in (None, "", False):
                    return True
                if contains_inline_credential(item):
                    return True
                if isinstance(item, (dict, list)):
                    pending.append(item)
        elif isinstance(current, list):
            pending.extend(item for item in current if isinstance(item, (dict, list)))
        elif contains_inline_credential(current):
            return True
    return False
