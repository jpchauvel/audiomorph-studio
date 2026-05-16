const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const MACHO_MAGIC_LE = [
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isMachO(filePath) {
  const fileHandle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await fileHandle.read(header, 0, 4, 0);
    if (bytesRead < 4) {
      return false;
    }

    return MACHO_MAGIC_LE.some((magic) => header.equals(magic));
  } finally {
    await fileHandle.close();
  }
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absolutePath);
      continue;
    }
    if (entry.isFile()) {
      yield absolutePath;
    }
  }
}

async function needsSigning(filePath) {
  if (filePath.endsWith(".dylib")) {
    return isMachO(filePath);
  }

  const stat = await fs.stat(filePath);
  const hasExecBit = (stat.mode & 0o111) !== 0;
  if (!hasExecBit) {
    return false;
  }

  return isMachO(filePath);
}

async function signFile(filePath, entitlementsPath, identity) {
  await execFileAsync("codesign", [
    "--force",
    "--options",
    "runtime",
    "--entitlements",
    entitlementsPath,
    "--sign",
    identity,
    filePath,
  ]);
}

module.exports = async function signPythonAfterPack(context) {
  const identity = process.env.CSC_NAME;
  if (!identity) {
    console.log("CSC_NAME not set, skipping Python resource signing");
    return;
  }

  const pythonDir = path.join(context.appOutDir, "Contents", "Resources", "python");
  if (!(await pathExists(pythonDir))) {
    return;
  }

  const entitlementsPath = path.join(__dirname, "entitlements.mac.plist");
  for await (const filePath of walk(pythonDir)) {
    if (await needsSigning(filePath)) {
      await signFile(filePath, entitlementsPath, identity);
    }
  }
};
