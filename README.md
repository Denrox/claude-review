# Claude Code Review

Automated code review tool that uses Claude CLI to review branches associated with a ticket across multiple repositories.

## How it works

1. Reads repository definitions from `repo.json`
2. Scans each repo for branches containing the given ticket ID
3. Clones repos where a matching branch is found
4. Generates a diff between the feature branch and the target branch
5. Runs Claude CLI to perform a code review focusing on:
   - **Repository pattern violations** (high priority)
   - **Code duplicates** (high priority)
   - **Security violations**
6. Writes review output to `artifacts/<ticketID>/<iteration>/<alias>.txt`

Each run auto-increments the iteration number. Claude is instructed to read previous iterations so it can track which issues have been fixed and avoid repeating them.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Git access to the repositories listed in `repo.json`

## Setup

1. Copy the example config and add your repositories:

   ```bash
   cp repo.json.example repo.json
   ```

2. Edit `repo.json`:

   ```json
   [
     {
       "url": "git@github.com:your-org/your-repo.git",
       "targetBranch": "main",
       "alias": "your-repo"
     }
   ]
   ```

   | Field          | Description                                      |
   | -------------- | ------------------------------------------------ |
   | `url`          | Git remote URL                                   |
   | `targetBranch` | Branch to diff against (e.g. `main`, `develop`)  |
   | `alias`        | Short name used for output files and log messages |

## Usage

```bash
# Basic — ticket ID only
node review.mjs -t PROJ-123
```

### Options

| Flag               | Required | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `-t`, `--ticket`   | Yes      | Ticket ID to search for in branch names              |
| `-r`, `--requirements` | No   | URL to ticket requirements (passed to Claude prompt) |

## Output

Reviews are saved to:

```
artifacts/
  └── PROJ-123/
      ├── 1/
      │   ├── your-repo.txt
      │   └── another-repo.txt
      └── 2/
          ├── your-repo.txt
          └── another-repo.txt
```

Each numbered directory is a review iteration. Subsequent runs automatically reference previous iterations so Claude can identify resolved vs. outstanding issues.
