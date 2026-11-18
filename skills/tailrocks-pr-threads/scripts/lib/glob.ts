// Minimal glob matcher for branch and path patterns: `*` matches within one
// path segment, `**` across segments, `?` one character.

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob.charAt(i);
    if (ch === "*") {
      if (glob.charAt(i + 1) === "*") {
        out += ".*";
        i += 1;
        if (glob.charAt(i + 1) === "/") {
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesAnyGlob(globs: readonly string[], text: string): boolean {
  return globs.some((glob) => globToRegExp(glob).test(text));
}
