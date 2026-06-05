import { randomBytes, scryptSync } from "node:crypto";

void main();

async function main(): Promise<void> {
  const passwordArg = process.argv[2]?.trim() ?? "";
  const password = passwordArg || (await readPasswordFromStdin());

  if (!password) {
    console.error("Usage: npm run hash:password -- \"your-password\"");
    console.error("Or: echo -n \"your-password\" | npm run hash:password");
    process.exit(1);
  }

  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);

  const output = [
    "scrypt",
    salt.toString("base64"),
    derivedKey.toString("base64")
  ].join("$");

  console.log(output);
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}
