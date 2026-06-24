# Hashing & Reproducibility Policy

Loom provides built-in mechanisms to hash notes and code blocks, enabling users to verify note integrity and guarantee reproducibility.

---

## The Hashing Model

Loom computes cryptographic hashes for both entire notes and individual code blocks:

- **Note Hash**: A SHA-256 hash computed over the canonical note content. Frontmatter keys associated with loom's tracking (such as `loom-note-hash` and `loom-reproducibility`) are automatically filtered out before hashing.
- **Code Block Hash**: A short hash computed for each block, derived from its vault-relative path, ordinal position, normalized language, block attributes, and the actual code contents.

---

## Reproducibility Snapshots

A reproducibility snapshot records the state of a note and all its executable blocks at a specific point in time.

### Saving a Snapshot
Running the command `loom: Save Reproducibility Snapshot` writes the following snapshot structure to the note's frontmatter under the `loom-reproducibility` key:

```yaml
loom-reproducibility:
  version: 1
  updatedAt: 2026-06-24T20:00:00.000Z
  noteHash: "abc123sha256hash..."
  policy:
    preset: "strict"
    ignoreFrontmatter: []
    ignoreBlockAttributes: []
  blocks:
    - id: "blockId"
      ordinal: 0
      language: "python"
      alias: "py"
      hash: "blockHash..."
      startLine: 12
      endLine: 16
```

### Verifying a Snapshot
Running the command `loom: Verify Reproducibility Snapshot` compares the current note contents and code blocks against the saved snapshot. The plugin generates a verification report in the frontmatter under `loom-reproducibility.verification` containing:

- **Status**: `"verified"` (note and blocks match), `"changed"` (mismatches detected), or `"missing-snapshot"`.
- **Issues**: A list detailing ordinal mismatches, missing blocks, or modified block code.

---

## Reproducibility Policies

A reproducibility policy controls which attributes or metadata fields are ignored during hashing. This prevents environment-specific details (like local file paths or container settings) from invalidating the document's verification status.

### Preset Policies

Loom offers four preset policies:

| Preset | ID | Ignored Fields / Attributes | Purpose |
| :--- | :--- | :--- | :--- |
| **Strict** | `strict` | None | Any change to the note, inputs, outputs, or environment settings invalidates the hash. |
| **Runtime Flexible** | `runtime-flexible` | `loom-execution`, `loom-cwd`, `loom-timeout`, etc. | Allows changing execution targets, directories, or timeouts without affecting code/prose verification. |
| **Runtime + Inputs** | `runtime-inputs` | Runtime fields + `loom-stdin`, `loom-stdin-file`, `loom-input`, etc. | Allows modifying the execution target and stdin sources/modes. |
| **Runtime + Inputs + Outputs** | `runtime-inputs-outputs` | Runtime and input fields + `loom-output-file`, `loom-output-lines`, etc. | Allows fully modifying execution targets, inputs, and where/how outputs are redirected. |

### Custom Policies
You can customize which fields are ignored during hashing by adding these frontmatter keys to the note:

- `loom-hash-ignore-frontmatter`: An array of note frontmatter keys to exclude from the note hash.
- `loom-hash-ignore-block-attributes`: An array of code block attributes to exclude from block hashes.

---

## Command Reference

The following commands are available from the command palette:

- `loom: Save Reproducibility Snapshot` - Records the current note and block hashes into the frontmatter.
- `loom: Verify Reproducibility Snapshot` - Compares the current note state to the saved snapshot and updates the verification report.
- `loom: Set Reproducibility Policy` - Opens a modal to select one of the preset policies for the current note.
- `loom: Copy Reproducibility Snapshot` - Copies the JSON snapshot of the note to the clipboard.
- `loom: Copy Reproducibility Verification Report` - Copies the active verification report JSON to the clipboard.
- `loom: Hash Current Note` - Generates a standalone SHA-256 hash of the note and writes it to `loom-note-hash` in frontmatter.
- `loom: Verify Current Note Hash` - Compares the current note against the standalone `loom-note-hash`.
- `loom: Hash Current Code Block` - Calculates the hash of the block under the cursor and writes/updates `loom-code-block-hashes` in frontmatter.
- `loom: Verify Code Block Hashes in Current Note` - Validates all blocks against the hashes stored in `loom-code-block-hashes`.
