#!/usr/bin/env node
// Thin entrypoint for npm/npx users. The renderer lives with the skill so that
// `npx skills add hookdump/colorito@colorito` installs a self-contained copy.
import "../skills/colorito/colorito.mjs";
