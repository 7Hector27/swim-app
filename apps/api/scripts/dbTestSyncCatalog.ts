import { applyTestEnv } from "./applyTestEnv";

applyTestEnv();

void import("../src/db/scripts/syncCatalog");
