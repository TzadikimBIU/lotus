# Observability, Logging, and Signing

Lotus can record execution events, note mutations, reproducibility operations, and signature checks to local or remote sinks. It can also sign notes so a trusted author can prove that the runnable document has not changed outside the selected reproducibility policy.

---

## Logging Model

Logging is configured from **Settings > Lotus > Logging**. When enabled, Lotus emits structured events for:

- Code block runs, failures, cancellations, and live input
- Output written to notes or files
- Hashing and reproducibility snapshot operations
- Note signatures and verification results
- Settings and execution target metadata

Each event includes a stable machine hash derived from the installation identifier. This lets operators correlate events from the same machine without exposing the raw identifier.

### Log Sinks

| Sink | Setting | Output |
| :--- | :--- | :--- |
| **Global text log** | Global text log path | Human-readable append-only events |
| **Global JSONL log** | Global JSONL log path | One structured JSON event per line |
| **Per-note text log** | Per-note text path pattern | Human-readable events grouped by note |
| **Per-note JSONL log** | Per-note JSONL path pattern | Structured events grouped by note |
| **Local process sink** | Local process command | Streams JSONL events to a child process stdin |
| **HTTP remote sink** | HTTP endpoint and headers | POSTs each structured event as JSON |

Per-note path patterns support `{note}` and `{hash}`. Use `Note path in logs` to record paths plainly, hash them, or omit them.

> [!CAUTION]
> Logging can capture sensitive operational context. Code, stdin/function input, and output streams are disabled by default in structured events. Enable them only when the configured sinks and retention policy are acceptable for that data.

---

## Redaction Rules

Redaction rules run before events are written to any sink. Configure one rule per line:

```text
secret-value => [redacted-secret]
/api[_-]?key\s*=\s*\S+/i => api_key=[redacted]
password => [redacted-password]
```

Rules can be plain text or JavaScript-style regular expressions in `/pattern/flags` form. If `=> replacement` is omitted, Lotus uses `[redacted]`.

Redaction applies to serialized event payloads. It is a defensive logging control, not a substitute for avoiding secrets in runnable notes.

---

## Log Viewer

The command palette command `lotus: Open Log Viewer` opens a right-side view over the configured JSONL log file.

Set **Log viewer JSONL path** to the file you want the viewer to read. The default is the global JSONL log path.

The viewer supports:

- Free-text search across raw event JSON
- Event type filtering
- Success, failure, and unknown status filtering
- Expanded raw JSON inspection

---

## Live Input and Function Input

Blocks can receive input while a process is running. If a block has no static `lotus-stdin` or `lotus-stdin-file`, Lotus opens a live stdin session for the run.

```python
name = input("Name: ")
print(f"Hello, {name}")
```

The output panel input sends lines to the running process. Press **Enter** to send, **Shift+Enter** to insert a newline, or **EOF** to close stdin.

For extracted function calls, `lotus-call=true` treats the block body as function input:

````markdown
```python lotus-file="lib/calculus.py" lotus-symbol=weighted_root lotus-call=true
25
```
````

The toolbar labels this as function input so it is distinct from process stdin.

---

## Cryptographic Signatures

Signatures are configured from **Settings > Lotus > Hashing and Observability**. Signing stores a `lotus-signature` record in note frontmatter and verifies it against the canonical reproducibility payload.

The signature payload includes:

- The note hash
- Code block hashes
- The active reproducibility policy
- The signing scheme, signer identity, key ID, and payload hash

`lotus-signature` itself is ignored when computing the signed payload, so writing the signature does not invalidate itself.

### Signature Methods

| Method | Use case | Private material handling |
| :--- | :--- | :--- |
| **OpenSSH / ssh-agent** | Team signing with pinned public keys | Uses `ssh-keygen -Y sign`; private keys can stay in `ssh-agent` |
| **RSA-PSS** | PEM based signing and verification | Private key PEM is pasted only for the signing operation |
| **Passphrase** | Lightweight local integrity checks | Passphrase can be kept in memory for the session only |

OpenSSH signing is the recommended mode for shared infrastructure. Configure:

```text
Signature method: OpenSSH / ssh-agent
Signer identity: analyst-1
OpenSSH signing key file: ~/.ssh/id_ed25519.pub
OpenSSH namespace: lotus-reproducibility@example.local
Allowed signers: analyst-1 namespaces="lotus-reproducibility@example.local" ssh-ed25519 ...
```

You can also set **Allowed signers file** to a vault-relative or absolute `allowed_signers` file. The namespace is checked during verification so a signature for another protocol or deployment is not accepted by accident.

> [!IMPORTANT]
> Lotus verifies document reproducibility and authorship. It does not prevent someone from bypassing Lotus and running a compiler, interpreter, or shell directly. Enforce that at the host, container, CI, or operating environment boundary.

---

## Command Reference

- `lotus: Open Log Viewer` - Opens the JSONL log viewer.
- `lotus: Sign Current Note` - Writes or refreshes `lotus-signature` on the active note.
- `lotus: Verify Current Note Signature` - Verifies the active note against its stored signature.
- `lotus: Copy Current Note Signature` - Copies the active note signature as JSON.
- `lotus: Sign All Notes` - Signs every Markdown note in the vault.
- `lotus: Verify All Note Signatures` - Verifies signatures across the vault.

For CI or shared-vault workflows, run the same verification outside Obsidian:

```bash
npm run verify:signatures -- --vault /path/to/vault
```

Passphrase signatures require `--passphrase` or `LOTUS_SIGNATURE_PASSPHRASE`. RSA and OpenSSH verification read the Lotus plugin settings when available, or can be supplied with `--public-key-file` and `--allowed-signers-file`. The script fails on missing signatures by default; use `--allow-missing` only for partial-vault audits.

---

## Light Builds

Strict builds include signing. Light builds can remove signing with the compile feature gate if the target deployment should not expose signing commands or settings:

```bash
npm run build:light -- --features=custom-languages,container-groups
```

When `signing` is omitted from a light build feature list, Lotus keeps hashing and logging but hides cryptographic signing controls.

The same feature gate applies to rich display surfaces. Omitting `rich-displays` from `--features` removes image/plot/source-visualization UI from light builds.
