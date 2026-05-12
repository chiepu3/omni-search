# OmniSearch

A PowerToys Run-like quick launcher Chrome extension with:
- **Site search**: Define shortcut keywords to search any site (e.g. `s query` → search)
- **History search**: Fuzzy search through browser history
- **Dictionary search**: Import CSV dictionaries, search inline, view details in modal

## Usage

Press **Alt+Shift+K** (customizable via chrome://extensions/shortcuts) to open the launcher.

| Key | Action |
|-----|--------|
| `Enter` | Open in current tab |
| `Ctrl+Enter` | Open in new tab |
| `Shift+Enter` | Open in new window |
| `↑↓` or `Tab` | Navigate results |
| `Esc` | Close |

## Development

```bash
npm install
npm run dev     # dev mode with hot reload
npm run build   # production build
npm run zip     # create distributable zip
```

## Tech Stack

- [WXT](https://wxt.dev/) — browser extension framework
- React 19 + TypeScript
- Tailwind CSS v4
- [Fuse.js](https://fusejs.io/) — fuzzy search
