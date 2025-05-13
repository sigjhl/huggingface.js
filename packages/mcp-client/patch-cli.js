// packages/mcp-client/patch-cli.js
const fs = require('fs');
const path = require('path');

const cliJsPath = path.join(__dirname, 'dist', 'cli.js');

console.log(`Attempting to patch: ${cliJsPath}`);

if (!fs.existsSync(cliJsPath)) {
    console.error(`ERROR: ${cliJsPath} not found. Run the build first.`);
    process.exit(1);
}

let content = fs.readFileSync(cliJsPath, 'utf8');

// Marker to ensure we don't patch multiple times or a completely wrong file
const patchMarker = "// MONKEY_PATCH_APPLIED_GET_EDITOR_COMMAND_V1";
if (content.includes(patchMarker)) {
    console.log("Patch already applied. Exiting.");
    process.exit(0);
}

// This is the problematic getEditorCommand function from your broken dist/cli.js
const buggyGetEditorCommandRegex = /function getEditorCommand\(\) \{\s*if \(import_node_process\.env\.EDITOR\) \{\s*return import_node_process\.env\.EDITOR;\s*\}\s*switch \(import_node_os\.platform\) \{\s*case "win32":\s*return "notepad";\s*case "darwin":\s*try \{\s*const result = \([\s\S]*?spawnSync\)\("which", \["nano"\], \{ stdio: "pipe" \}\);\s*if \(result\.status === 0\)\s*return "nano -t";\s*\} catch \(err\) \{\s*\}\s*try \{\s*const result = \([\s\S]*?spawnSync\)\("which", \["vim"\], \{ stdio: "pipe" \}\);\s*if \(result\.status === 0\)\s*return "vim";\s*\} catch \(err\) \{\s*\}\s*try \{\s*const result = \([\s\S]*?spawnSync\)\("which", \["vi"\], \{ stdio: "pipe" \}\);\s*if \(result\.status === 0\)\s*return "vi";\s*\} catch \(err\) \{\s*\}\s*return "open -W -t";\s*default:\s*const editors = \["nano", "vim", "vi"\];\s*for \(const editor of editors\) \{\s*try \{\s*const result = \([\s\S]*?spawnSync\)\("which", \[editor\], \{ stdio: "pipe" \}\);\s*if \(result\.status === 0 && result\.stdout && result\.stdout\.toString\(\)\.trim\(\)\.length > 0\) \{\s*return editor;\s*\}\s*\} catch \(err\) \{\s*\}\s*\}\s*return "nano";\s*\}\s*\}/;


// This is the CORRECT getEditorCommand function content (taken from your working cli.ts and adapted for JS)
const correctGetEditorCommandFunction = `
function getEditorCommand() {
  ${patchMarker}
  if (import_node_process.env.EDITOR) {
    return import_node_process.env.EDITOR;
  }
  switch (import_node_os.platform) { // Assuming import_node_os.platform is correctly defined from 'os' or 'process'
    case "win32":
      return "notepad";
    case "darwin": // macOS
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["nano"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "nano -t";
        }
      } catch (err) { /* ignore */ }
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["vim"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "vim";
        }
      } catch (err) { /* ignore */ }
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["vi"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "vi";
        }
      } catch (err) { /* ignore */ }
      return "open -W -t"; // Last resort for macOS
    default: // Linux and others
      const editors = ["nano", "vim", "vi"];
      for (const editor of editors) {
        try {
          const result = (0, import_node_child_process.spawnSync)("which", [editor], { stdio: "pipe" });
          if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
            return editor;
          }
        } catch (err) { /* ignore */ }
      }
      return "nano"; // Default if nothing else found
  }
}`;

let match = content.match(buggyGetEditorCommandRegex);

if (match) {
    console.log("Buggy getEditorCommand function found. Replacing...");
    content = content.replace(buggyGetEditorCommandRegex, correctGetEditorCommandFunction);
    fs.writeFileSync(cliJsPath, content, 'utf8');
    console.log("Patch applied successfully!");
} else {
    console.error("ERROR: Could not find the buggy getEditorCommand function signature in dist/cli.js. Has the file changed significantly, or was the regex incorrect?");
    // For debugging the regex, you can log a snippet of the expected area:
    const searchString = "function getEditorCommand() {";
    const indexOfSearch = content.indexOf(searchString);
    if(indexOfSearch > -1) {
        console.log("Snippet around expected location:\n", content.substring(Math.max(0, indexOfSearch - 50), indexOfSearch + 500));
    } else {
        console.log("Could not even find 'function getEditorCommand() {' string.");
    }
    process.exit(1);
}