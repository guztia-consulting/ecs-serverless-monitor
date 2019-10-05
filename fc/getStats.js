const moment = require('moment');

const ONE_MINUTE = 60;
const TEN_MINUTES = 600;
const ONE_HOUR = 3600;
const SIX_HOURS = 21600;
const FORTY_EIGHT_HOURS = 172800;
const FOUR_HUNDRED_HOURS = 1440000; // About 16 days and a half

const normalizeStatsData = function (res) {
  const output = {timestamps: [], samples: []};
  const normalized = [];

  JSON.parse(res.Datapoints).forEach(function (monitorData) {
    normalized.push({
      timestamp: monitorData.timestamp,
      value: Math.round(monitorData.Maximum),
    });
  });

  normalized.sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  normalized.forEach(function (sample) {
    output.timestamps.push(sample.timestamp);
    output.samples.push(sample.value);
  });

  return output;
};

exports.handler = function (event, context, callback) {
  const parsedEvent = JSON.parse(event);
  const {token, regionId, instanceId, time} = parsedEvent.queryParameters;
  console.log('Query parameters parsed');

  const metrics = {cpu: null, disk: null, memory: null, price: null};

  let Period = ONE_MINUTE;
  if (time > SIX_HOURS && time <= FORTY_EIGHT_HOURS) {
    Period = TEN_MINUTES;
  } else if (time > FORTY_EIGHT_HOURS && time <= FOUR_HUNDRED_HOURS) {
    Period = ONE_HOUR;
  }

  const endTime = moment().format();
  const startTime = moment(endTime).subtract(time, 'seconds').format();
  const EndTime = `${endTime.slice(0, -6)}Z`;

  const response = function (err, res) {
    console.log(`getStats response`);

    let body;
    if (err !== null) {
      body = JSON.stringify(err);
    } else {
      body = JSON.stringify(res);
    }

    callback(null, {statusCode: 200, headers: {'Content-type': 'application/json'}, body});
  };

  const {accessKeyId, accessKeySecret, securityToken} = context.credentials;

  const clientParams = {
    accessKeyId,
    accessKeySecret,
    securityToken,
    opts: {timeout: 10000},
    endpoint: `https://metrics.${regionId}.aliyuncs.com`,
    apiVersion: '2019-01-01'
  };

  console.log(clientParams);

  const fetchData = async () => {
    const promisesArray = [];
    const aliyun = require('@alicloud/pop-core');
    const monitorClient = new aliyun(clientParams);

    const StartTime = `${startTime.slice(0, -6)}Z`;
    const Dimensions = JSON.stringify({instanceId});
    const Namespace = 'acs_ecs_dashboard';
    const BaseQuery = {EndTime, StartTime, Period, Dimensions, Namespace};
    const cpuQuery = {...BaseQuery, ...{MetricName: 'CPUUtilization'}};
    const memoryQuery = {...BaseQuery, ...{MetricName: 'memory_usedutilization'}};
    const diskQuery = {...BaseQuery, ...{MetricName: 'diskusage_utilization'}};

    console.log('Aliyun CloudMonitor initialised');
    console.log('Calling DescribeMetricData');

    promisesArray.push(new Promise(function (resolve, reject) {
      console.log('Calling DescribeMetricData for cpu');
      monitorClient.request('DescribeMetricData', cpuQuery, {method: 'POST'}).then((res) => {
        metrics.cpu = normalizeStatsData(res);
        resolve();
      }, reject);
    }));

    promisesArray.push(new Promise(function (resolve, reject) {
      console.log('Calling DescribeMetricData for memory');
      monitorClient.request('DescribeMetricData', memoryQuery, {method: 'POST'}).then((res) => {
        metrics.memory = normalizeStatsData(res);
        resolve();
      }, reject);
    }));

    promisesArray.push(new Promise(function (resolve, reject) {
      console.log('Calling DescribeMetricData for disk');
      monitorClient.request('DescribeMetricData', diskQuery, {method: 'POST'}).then((res) => {
        metrics.disk = normalizeStatsData(res);
        resolve();
      }, reject);
    }));

    Promise.all(promisesArray).then(function () {
      response(null, metrics);
    });
  };

  if (token === process.env['token']) {
    fetchData();
  } else {
    response({message: 'wrong token'}, null);
  }

};
