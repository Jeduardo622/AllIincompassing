/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups, runRoleMatrix } from "../support/routeScenarios";

describe("Admin and back-office route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  runRoleMatrix("admin/back-office routes", routeGroups.admin);
});
