/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups, runRoleMatrix } from "../support/routeScenarios";

describe("Messages route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  runRoleMatrix("messages routes", routeGroups.messages);
});
