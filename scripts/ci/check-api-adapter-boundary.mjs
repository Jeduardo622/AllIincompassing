import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const assertContains = (relativePath, snippet, description) => {
  const content = read(relativePath);
  if (!content.includes(snippet)) {
    fail(`${relativePath} is missing ${description}`);
  }
};

const assertNotContains = (relativePath, snippet, description) => {
  const content = read(relativePath);
  if (content.includes(snippet)) {
    fail(`${relativePath} still contains ${description}`);
  }
};

const run = () => {
  assertContains(
    "src/server/api/dashboard.ts",
    'functionName: "get-dashboard-data"',
    "edge authority proxy mapping to get-dashboard-data",
  );
  assertContains(
    "src/server/api/sessions-start.ts",
    'functionName: "sessions-start"',
    "edge authority proxy mapping to sessions-start",
  );
  assertContains(
    "src/server/api/book.ts",
    'functionName: "sessions-book"',
    "edge authority proxy mapping to sessions-book",
  );

  assertNotContains(
    "netlify/functions/book.ts",
    "fetch(",
    "in-function business logic (book should remain a transport adapter)",
  );
  assertNotContains(
    "netlify/functions/dashboard.ts",
    "fetch(",
    "in-function business logic (dashboard should remain a transport adapter)",
  );
  assertNotContains(
    "netlify/functions/sessions-start.ts",
    "fetch(",
    "in-function business logic (sessions-start should remain a transport adapter)",
  );

  console.log("API adapter boundary check passed.");
};

run();

