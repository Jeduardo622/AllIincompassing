/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups, runRoleMatrix } from "../support/routeScenarios";

describe("Time route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  runRoleMatrix("time routes", routeGroups.time);
});
