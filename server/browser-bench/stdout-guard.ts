// stdout carries the MCP protocol, so anything a module logs goes to stderr.
console.log = console.error;
console.info = console.error;
