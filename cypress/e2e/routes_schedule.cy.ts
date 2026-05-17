/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups, runRoleMatrix } from "../support/routeScenarios";

describe("Schedule route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  runRoleMatrix("schedule routes", routeGroups.schedule);
});
