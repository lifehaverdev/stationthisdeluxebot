// TODO: replace with real users router
module.exports = {
  createUserCoreApi: require('./userCoreApi'),
  createUserSessionsApi: require('./userSessionsApi'),
  createUserEventsApi: require('./userEventsApi'),
  createUserPreferencesApiRouter: require('./userPreferencesApi'),
  createUserStatusReportApiService: require('./userStatusReportApi'),
};
