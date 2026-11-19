import { describe, expect, test } from "bun:test";
import { classifyPush } from "../lib/create/push.ts";

const TO = "To https://example.invalid/example-org/example-repo.git";

describe("classifyPush: the class comes from git's ref status lines", () => {
  test.each(["non-fast-forward", "fetch first", "stale info"])("a rejected ref (%s) means the remote branch moved", (reason) => {
    const stderr = `${TO}\n ! [rejected]        abc -> feat/topic (${reason})\nerror: failed to push some refs to 'x'\n`;
    const result = classifyPush(stderr, 1);
    expect(result.kind).toBe("moved");
    expect(result.cause).toBe(`! [rejected]        abc -> feat/topic (${reason})`);
  });

  test("a [remote rejected] ref is declined, whatever the reason says", () => {
    for (const reason of ["pre-receive hook declined", "non-fast-forward", "fetch first", "protected branch hook declined"]) {
      const result = classifyPush(`${TO}\n ! [remote rejected] abc -> feat/topic (${reason})\nerror: failed to push some refs\n`, 1);
      expect(result.kind).toBe("declined");
      expect(result.cause).toContain("[remote rejected]");
    }
  });

  test("a word in a hook message or in the summary does not decide the class", () => {
    // A hook prints "remote:" lines. The words can be anything.
    const hookWords = `remote: permission denied: non-fast-forward fetch first stale info\n${TO}\n ! [remote rejected] abc -> feat/topic (hook declined)\n`;
    expect(classifyPush(hookWords, 1).kind).toBe("declined");
    // A plain rejection whose summary says "denied" and "permission" is still a moved branch.
    const noise = `${TO}\n ! [rejected]        abc -> feat/topic (fetch first)\nerror: failed to push some refs\nhint: permission denied, protected branch, declined, [remote rejected]\n`;
    expect(classifyPush(noise, 1).kind).toBe("moved");
  });

  test("no status line: the words of the output never make it a moved branch", () => {
    const stderr = `remote: non-fast-forward, fetch first, stale info\nfatal: unable to access 'x': The requested URL returned error: 403\n`;
    const result = classifyPush(stderr, 128);
    expect(result.kind).toBe("other");
    expect(result.cause).toBe("fatal: unable to access 'x': The requested URL returned error: 403");
  });

  test("a rejected ref with another reason is not a moved branch", () => {
    expect(classifyPush(`${TO}\n ! [rejected]        abc -> feat/topic (already exists)\n`, 1).kind).toBe("other");
  });

  test("the cause is never the To line", () => {
    expect(classifyPush(`${TO}\n ! [remote rejected] a -> b (hook declined)\n`, 1).cause).not.toMatch(/^To /);
    expect(classifyPush(`${TO}\nsomething odd happened\n`, 1).cause).toBe("something odd happened");
    expect(classifyPush(`${TO}\n`, 7).cause).toBe("exit 7");
    expect(classifyPush("", 1).cause).toBe("exit 1");
  });
});
