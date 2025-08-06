module.exports = {
  createStatusApi: require('./statusApi').createStatusApi,
  createAdminApi: require('./adminApi').createAdminApi,
  createWebhookApi: require('./webhookApi').createWebhookApi,
};
