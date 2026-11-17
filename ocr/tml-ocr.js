(function(){var global=(typeof self!=="undefined"?self:window);var __m={},__c={};function __r(id){if(__c[id])return __c[id].exports;var m=__c[id]={exports:{}};__m[id](m,m.exports);return m.exports;}
__m[0]=function(module,exports){var require=function(r){return __r({"regenerator-runtime/runtime":1,"./createScheduler":2,"./createWorker":6,"./Tesseract":21,"./constants/languages":22,"./constants/OEM":11,"./constants/PSM":23,"./utils/log":5}[r]);};
/**
 *
 * Entry point for tesseract.js, should be the entry when bundling.
 *
 * @fileoverview entry point for tesseract.js
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */
require('regenerator-runtime/runtime');
const createScheduler = require('./createScheduler');
const createWorker = require('./createWorker');
const Tesseract = require('./Tesseract');
const languages = require('./constants/languages');
const OEM = require('./constants/OEM');
const PSM = require('./constants/PSM');
const { setLogging } = require('./utils/log');

module.exports = {
  languages,
  OEM,
  PSM,
  createScheduler,
  createWorker,
  setLogging,
  ...Tesseract,
};

};
__m[1]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports={};
};
__m[2]=function(module,exports){var require=function(r){return __r({"./createJob":3,"./utils/log":5,"./utils/getId":4}[r]);};
const createJob = require('./createJob');
const { log } = require('./utils/log');
const getId = require('./utils/getId');

let schedulerCounter = 0;

module.exports = () => {
  const id = getId('Scheduler', schedulerCounter);
  const workers = {};
  const runningWorkers = {};
  let jobQueue = [];

  schedulerCounter += 1;

  const getQueueLen = () => jobQueue.length;
  const getNumWorkers = () => Object.keys(workers).length;

  const dequeue = () => {
    if (jobQueue.length !== 0) {
      const wIds = Object.keys(workers);
      for (let i = 0; i < wIds.length; i += 1) {
        if (typeof runningWorkers[wIds[i]] === 'undefined') {
          jobQueue[0](workers[wIds[i]]);
          break;
        }
      }
    }
  };

  const queue = (action, payload) => (
    new Promise((resolve, reject) => {
      const job = createJob({ action, payload });
      jobQueue.push(async (w) => {
        jobQueue.shift();
        runningWorkers[w.id] = job;
        try {
          resolve(await w[action].apply(this, [...payload, job.id]));
        } catch (err) {
          reject(err);
        } finally {
          delete runningWorkers[w.id];
          dequeue();
        }
      });
      log(`[${id}]: Add ${job.id} to JobQueue`);
      log(`[${id}]: JobQueue length=${jobQueue.length}`);
      dequeue();
    })
  );

  const addWorker = (w) => {
    workers[w.id] = w;
    log(`[${id}]: Add ${w.id}`);
    log(`[${id}]: Number of workers=${getNumWorkers()}`);
    dequeue();
    return w.id;
  };

  const addJob = async (action, ...payload) => {
    if (getNumWorkers() === 0) {
      throw Error(`[${id}]: You need to have at least one worker before adding jobs`);
    }
    return queue(action, payload);
  };

  const terminate = async () => {
    Object.keys(workers).forEach(async (wid) => {
      await workers[wid].terminate();
    });
    jobQueue = [];
  };

  return {
    addWorker,
    addJob,
    terminate,
    getQueueLen,
    getNumWorkers,
  };
};

};
__m[3]=function(module,exports){var require=function(r){return __r({"./utils/getId":4}[r]);};
const getId = require('./utils/getId');

let jobCounter = 0;

module.exports = ({
  id: _id,
  action,
  payload = {},
}) => {
  let id = _id;
  if (typeof id === 'undefined') {
    id = getId('Job', jobCounter);
    jobCounter += 1;
  }

  return {
    id,
    action,
    payload,
  };
};

};
__m[4]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports = (prefix, cnt) => (
  `${prefix}-${cnt}-${Math.random().toString(16).slice(3, 8)}`
);

};
__m[5]=function(module,exports){var require=function(r){return __r({}[r]);};
let logging = false;

exports.logging = logging;

exports.setLogging = (_logging) => {
  logging = _logging;
};

exports.log = (...args) => (logging ? console.log.apply(this, args) : null);

};
__m[6]=function(module,exports){var require=function(r){return __r({"./utils/resolvePaths":7,"./utils/circularize":10,"./createJob":3,"./utils/log":5,"./utils/getId":4,"./constants/OEM":11,"./worker/node":12}[r]);};
const resolvePaths = require('./utils/resolvePaths');
const circularize = require('./utils/circularize');
const createJob = require('./createJob');
const { log } = require('./utils/log');
const getId = require('./utils/getId');
const OEM = require('./constants/OEM');
const {
  defaultOptions,
  spawnWorker,
  terminateWorker,
  onMessage,
  loadImage,
  send,
} = require('./worker/node');

let workerCounter = 0;

module.exports = async (langs = 'eng', oem = OEM.LSTM_ONLY, _options = {}, config = {}) => {
  const id = getId('Worker', workerCounter);
  const {
    logger,
    errorHandler,
    ...options
  } = resolvePaths({
    ...defaultOptions,
    ..._options,
  });
  const resolves = {};
  const rejects = {};

  // Current langs, oem, and config file.
  // Used if the user ever re-initializes the worker using `worker.reinitialize`.
  const currentLangs = typeof langs === 'string' ? langs.split('+') : langs;
  let currentOem = oem;
  let currentConfig = config;
  const lstmOnlyCore = [OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem) && !options.legacyCore;

  let workerResReject;
  let workerResResolve;
  const workerRes = new Promise((resolve, reject) => {
    workerResResolve = resolve;
    workerResReject = reject;
  });
  const workerError = (event) => { workerResReject(event.message); };

  let worker = spawnWorker(options);
  worker.onerror = workerError;

  workerCounter += 1;

  const setResolve = (promiseId, res) => {
    resolves[promiseId] = res;
  };

  const setReject = (promiseId, rej) => {
    rejects[promiseId] = rej;
  };

  const startJob = ({ id: jobId, action, payload }) => (
    new Promise((resolve, reject) => {
      log(`[${id}]: Start ${jobId}, action=${action}`);
      // Using both `action` and `jobId` in case user provides non-unique `jobId`.
      const promiseId = `${action}-${jobId}`;
      setResolve(promiseId, resolve);
      setReject(promiseId, reject);
      send(worker, {
        workerId: id,
        jobId,
        action,
        payload,
      });
    })
  );

  const load = () => (
    console.warn('`load` is depreciated and should be removed from code (workers now come pre-loaded)')
  );

  const loadInternal = (jobId) => (
    startJob(createJob({
      id: jobId, action: 'load', payload: { options: { lstmOnly: lstmOnlyCore, corePath: options.corePath, logging: options.logging } },
    }))
  );

  const writeText = (path, text, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'FS',
      payload: { method: 'writeFile', args: [path, text] },
    }))
  );

  const readText = (path, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'FS',
      payload: { method: 'readFile', args: [path, { encoding: 'utf8' }] },
    }))
  );

  const removeFile = (path, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'FS',
      payload: { method: 'unlink', args: [path] },
    }))
  );

  const FS = (method, args, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'FS',
      payload: { method, args },
    }))
  );

  const loadLanguage = () => (
    console.warn('`loadLanguage` is depreciated and should be removed from code (workers now come with language pre-loaded)')
  );

  const loadLanguageInternal = (_langs, jobId) => startJob(createJob({
    id: jobId,
    action: 'loadLanguage',
    payload: {
      langs: _langs,
      options: {
        langPath: options.langPath,
        dataPath: options.dataPath,
        cachePath: options.cachePath,
        cacheMethod: options.cacheMethod,
        gzip: options.gzip,
        lstmOnly: [OEM.DEFAULT, OEM.LSTM_ONLY].includes(currentOem)
          && !options.legacyLang,
      },
    },
  }));

  const initialize = () => (
    console.warn('`initialize` is depreciated and should be removed from code (workers now come pre-initialized)')
  );

  const initializeInternal = (_langs, _oem, _config, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'initialize',
      payload: { langs: _langs, oem: _oem, config: _config },
    }))
  );

  const reinitialize = (langs = 'eng', oem, config, jobId) => { // eslint-disable-line

    if (lstmOnlyCore && [OEM.TESSERACT_ONLY, OEM.TESSERACT_LSTM_COMBINED].includes(oem)) throw Error('Legacy model requested but code missing.');

    const _oem = oem || currentOem;
    currentOem = _oem;

    const _config = config || currentConfig;
    currentConfig = _config;

    // Only load langs that are not already loaded.
    // This logic fails if the user downloaded the LSTM-only English data for a language
    // and then uses `worker.reinitialize` to switch to the Legacy engine.
    // However, the correct data will still be downloaded after initialization fails
    // and this can be avoided entirely if the user loads the correct data ahead of time.
    const langsArr = typeof langs === 'string' ? langs.split('+') : langs;
    const _langs = langsArr.filter((x) => !currentLangs.includes(x));
    currentLangs.push(..._langs);

    if (_langs.length > 0) {
      return loadLanguageInternal(_langs, jobId)
        .then(() => initializeInternal(langs, _oem, _config, jobId));
    }

    return initializeInternal(langs, _oem, _config, jobId);
  };

  const setParameters = (params = {}, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'setParameters',
      payload: { params },
    }))
  );

  const recognize = async (image, opts = {}, output = {
    blocks: true, text: true, hocr: true, tsv: true,
  }, jobId) => (
    startJob(createJob({
      id: jobId,
      action: 'recognize',
      payload: { image: await loadImage(image), options: opts, output },
    }))
  );

  const getPDF = (title = 'Tesseract OCR Result', textonly = false, jobId) => {
    console.log('`getPDF` function is depreciated. `recognize` option `savePDF` should be used instead.');
    return startJob(createJob({
      id: jobId,
      action: 'getPDF',
      payload: { title, textonly },
    }));
  };

  const detect = async (image, jobId) => {
    if (lstmOnlyCore) throw Error('`worker.detect` requires Legacy model, which was not loaded.');

    return startJob(createJob({
      id: jobId,
      action: 'detect',
      payload: { image: await loadImage(image) },
    }));
  };

  const terminate = async () => {
    if (worker !== null) {
      /*
      await startJob(createJob({
        id: jobId,
        action: 'terminate',
      }));
      */
      terminateWorker(worker);
      worker = null;
    }
    return Promise.resolve();
  };

  onMessage(worker, ({
    workerId, jobId, status, action, data,
  }) => {
    const promiseId = `${action}-${jobId}`;
    if (status === 'resolve') {
      log(`[${workerId}]: Complete ${jobId}`);
      let d = data;
      if (action === 'recognize') {
        d = circularize(data);
      } else if (action === 'getPDF') {
        d = Array.from({ ...data, length: Object.keys(data).length });
      }
      resolves[promiseId]({ jobId, data: d });
    } else if (status === 'reject') {
      rejects[promiseId](data);
      if (action === 'load') workerResReject(data);
      if (errorHandler) {
        errorHandler(data);
      } else {
        throw Error(data);
      }
    } else if (status === 'progress') {
      logger({ ...data, userJobId: jobId });
    }
  });

  const resolveObj = {
    id,
    worker,
    setResolve,
    setReject,
    load,
    writeText,
    readText,
    removeFile,
    FS,
    loadLanguage,
    initialize,
    reinitialize,
    setParameters,
    recognize,
    getPDF,
    detect,
    terminate,
  };

  loadInternal()
    .then(() => loadLanguageInternal(langs))
    .then(() => initializeInternal(langs, oem, config))
    .then(() => workerResResolve(resolveObj))
    .catch(() => {});

  return workerRes;
};

};
__m[7]=function(module,exports){var require=function(r){return __r({"./getEnvironment":8}[r]);};
const isBrowser = require('./getEnvironment')('type') === 'browser';

const resolveURL = isBrowser ? s => (new URL(s, window.location.href)).href : s => s; // eslint-disable-line

module.exports = (options) => {
  const opts = { ...options };
  ['corePath', 'workerPath', 'langPath'].forEach((key) => {
    if (options[key]) {
      opts[key] = resolveURL(opts[key]);
    }
  });
  return opts;
};

};
__m[8]=function(module,exports){var require=function(r){return __r({"is-electron":9}[r]);};
const isElectron = require('is-electron');

module.exports = (key) => {
  const env = {};

  if (typeof WorkerGlobalScope !== 'undefined') {
    env.type = 'webworker';
  } else if (isElectron()) {
    env.type = 'electron';
  } else if (typeof document === 'object') {
    env.type = 'browser';
  } else if (typeof process === 'object' && typeof require === 'function') {
    env.type = 'node';
  }

  if (typeof key === 'undefined') {
    return env;
  }

  return env[key];
};

};
__m[9]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports=function(){return false;};
};
__m[10]=function(module,exports){var require=function(r){return __r({}[r]);};
/**
 * In the recognition result of tesseract, there
 * is a deep JSON object for details, it has around
 *
 * The result of dump.js is a big JSON tree
 * which can be easily serialized (for instance
 * to be sent from a webworker to the main app
 * or through Node's IPC), but we want
 * a (circular) DOM-like interface for walking
 * through the data.
 *
 * @fileoverview DOM-like interface for walking through data
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */

module.exports = (page) => {
  const blocks = [];
  const paragraphs = [];
  const lines = [];
  const words = [];
  const symbols = [];

  if (page.blocks) {
    page.blocks.forEach((block) => {
      block.paragraphs.forEach((paragraph) => {
        paragraph.lines.forEach((line) => {
          line.words.forEach((word) => {
            word.symbols.forEach((sym) => {
              symbols.push({
                ...sym, page, block, paragraph, line, word,
              });
            });
            words.push({
              ...word, page, block, paragraph, line,
            });
          });
          lines.push({
            ...line, page, block, paragraph,
          });
        });
        paragraphs.push({
          ...paragraph, page, block,
        });
      });
      blocks.push({
        ...block, page,
      });
    });
  }

  return {
    ...page, blocks, paragraphs, lines, words, symbols,
  };
};

};
__m[11]=function(module,exports){var require=function(r){return __r({}[r]);};
/*
 * OEM = OCR Engine Mode, and there are 4 possible modes.
 *
 * By default tesseract.js uses LSTM_ONLY mode.
 *
 */
module.exports = {
  TESSERACT_ONLY: 0,
  LSTM_ONLY: 1,
  TESSERACT_LSTM_COMBINED: 2,
  DEFAULT: 3,
};

};
__m[12]=function(module,exports){var require=function(r){return __r({"./defaultOptions":13,"./spawnWorker":16,"./terminateWorker":17,"./onMessage":18,"./send":19,"./loadImage":20}[r]);};
/**
 *
 * Tesseract Worker adapter for browser
 *
 * @fileoverview Tesseract Worker adapter for browser
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */
const defaultOptions = require('./defaultOptions');
const spawnWorker = require('./spawnWorker');
const terminateWorker = require('./terminateWorker');
const onMessage = require('./onMessage');
const send = require('./send');
const loadImage = require('./loadImage');

module.exports = {
  defaultOptions,
  spawnWorker,
  terminateWorker,
  onMessage,
  send,
  loadImage,
};

};
__m[13]=function(module,exports){var require=function(r){return __r({"../../../package.json":14,"../../constants/defaultOptions":15}[r]);};
const version = require('../../../package.json').version;
const defaultOptions = require('../../constants/defaultOptions');

/*
 * Default options for browser worker
 */
module.exports = {
  ...defaultOptions,
  workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@v${version}/dist/worker.min.js`,
};

};
__m[14]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports={
  "name": "tesseract.js",
  "version": "5.1.1",
  "description": "Pure Javascript Multilingual OCR",
  "main": "src/index.js",
  "types": "src/index.d.ts",
  "unpkg": "dist/tesseract.min.js",
  "jsdelivr": "dist/tesseract.min.js",
  "scripts": {
    "start": "node scripts/server.js",
    "build": "rimraf dist && webpack --config scripts/webpack.config.prod.js && rollup -c scripts/rollup.esm.mjs",
    "profile:tesseract": "webpack-bundle-analyzer dist/tesseract-stats.json",
    "profile:worker": "webpack-bundle-analyzer dist/worker-stats.json",
    "prepublishOnly": "npm run build",
    "wait": "rimraf dist && wait-on http://localhost:3000/dist/tesseract.min.js",
    "test": "npm-run-all -p -r start test:all",
    "test:all": "npm-run-all wait test:browser:* test:node:all",
    "test:node": "nyc mocha --exit --bail --require ./scripts/test-helper.js",
    "test:node:all": "npm run test:node -- ./tests/*.test.js",
    "test:browser-tpl": "mocha-headless-chrome -a incognito -a no-sandbox -a disable-setuid-sandbox -a disable-logging -t 300000",
    "test:browser:detect": "npm run test:browser-tpl -- -f ./tests/detect.test.html",
    "test:browser:recognize": "npm run test:browser-tpl -- -f ./tests/recognize.test.html",
    "test:browser:scheduler": "npm run test:browser-tpl -- -f ./tests/scheduler.test.html",
    "test:browser:FS": "npm run test:browser-tpl -- -f ./tests/FS.test.html",
    "lint": "eslint src",
    "lint:fix": "eslint --fix src",
    "postinstall": "opencollective-postinstall || true"
  },
  "browser": {
    "./src/worker/node/index.js": "./src/worker/browser/index.js"
  },
  "author": "",
  "contributors": [
    "jeromewu"
  ],
  "license": "Apache-2.0",
  "devDependencies": {
    "@babel/core": "^7.21.4",
    "@babel/eslint-parser": "^7.21.3",
    "@babel/preset-env": "^7.21.4",
    "@rollup/plugin-commonjs": "^24.1.0",
    "acorn": "^8.8.2",
    "babel-loader": "^9.1.2",
    "buffer": "^6.0.3",
    "cors": "^2.8.5",
    "eslint": "^7.32.0",
    "eslint-config-airbnb-base": "^14.2.1",
    "eslint-plugin-import": "^2.27.5",
    "expect.js": "^0.3.1",
    "express": "^4.18.2",
    "mocha": "^10.2.0",
    "mocha-headless-chrome": "^4.0.0",
    "npm-run-all": "^4.1.5",
    "nyc": "^15.1.0",
    "rimraf": "^5.0.0",
    "rollup": "^3.20.7",
    "wait-on": "^7.0.1",
    "webpack": "^5.79.0",
    "webpack-bundle-analyzer": "^4.8.0",
    "webpack-cli": "^5.0.1",
    "webpack-dev-middleware": "^6.0.2",
    "rollup-plugin-sourcemaps": "^0.6.3"
  },
  "dependencies": {
    "bmp-js": "^0.1.0",
    "idb-keyval": "^6.2.0",
    "is-electron": "^2.2.2",
    "is-url": "^1.2.4",
    "node-fetch": "^2.6.9",
    "opencollective-postinstall": "^2.0.3",
    "regenerator-runtime": "^0.13.3",
    "tesseract.js-core": "^5.1.1",
    "wasm-feature-detect": "^1.2.11",
    "zlibjs": "^0.3.1"
  },
  "overrides": {
    "@rollup/pluginutils": "^5.0.2"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/naptha/tesseract.js.git"
  },
  "bugs": {
    "url": "https://github.com/naptha/tesseract.js/issues"
  },
  "homepage": "https://github.com/naptha/tesseract.js",
  "collective": {
    "type": "opencollective",
    "url": "https://opencollective.com/tesseractjs"
  }
}
;
};
__m[15]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports = {
  /*
   * Use BlobURL for worker script by default
   * TODO: remove this option
   *
   */
  workerBlobURL: true,
  logger: () => {},
};

};
__m[16]=function(module,exports){var require=function(r){return __r({}[r]);};
/**
 * spawnWorker
 *
 * @name spawnWorker
 * @function create a new Worker in browser
 * @access public
 */
module.exports = ({ workerPath, workerBlobURL }) => {
  let worker;
  if (Blob && URL && workerBlobURL) {
    const blob = new Blob([`importScripts("${workerPath}");`], {
      type: 'application/javascript',
    });
    worker = new Worker(URL.createObjectURL(blob));
  } else {
    worker = new Worker(workerPath);
  }

  return worker;
};

};
__m[17]=function(module,exports){var require=function(r){return __r({}[r]);};
/**
 * terminateWorker
 *
 * @name terminateWorker
 * @function terminate worker
 * @access public
 */
module.exports = (worker) => {
  worker.terminate();
};

};
__m[18]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports = (worker, handler) => {
  worker.onmessage = ({ data }) => { // eslint-disable-line
    handler(data);
  };
};

};
__m[19]=function(module,exports){var require=function(r){return __r({}[r]);};
/**
 * send
 *
 * @name send
 * @function send packet to worker and create a job
 * @access public
 */
module.exports = async (worker, packet) => {
  worker.postMessage(packet);
};

};
__m[20]=function(module,exports){var require=function(r){return __r({}[r]);};
/**
 * readFromBlobOrFile
 *
 * @name readFromBlobOrFile
 * @function
 * @access private
 */
const readFromBlobOrFile = (blob) => (
  new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = () => {
      resolve(fileReader.result);
    };
    fileReader.onerror = ({ target: { error: { code } } }) => {
      reject(Error(`File could not be read! Code=${code}`));
    };
    fileReader.readAsArrayBuffer(blob);
  })
);

/**
 * loadImage
 *
 * @name loadImage
 * @function load image from different source
 * @access private
 */
const loadImage = async (image) => {
  let data = image;
  if (typeof image === 'undefined') {
    return 'undefined';
  }

  if (typeof image === 'string') {
    // Base64 Image
    if (/data:image\/([a-zA-Z]*);base64,([^"]*)/.test(image)) {
      data = atob(image.split(',')[1])
        .split('')
        .map((c) => c.charCodeAt(0));
    } else {
      const resp = await fetch(image);
      data = await resp.arrayBuffer();
    }
  } else if (typeof HTMLElement !== 'undefined' && image instanceof HTMLElement) {
    if (image.tagName === 'IMG') {
      data = await loadImage(image.src);
    }
    if (image.tagName === 'VIDEO') {
      data = await loadImage(image.poster);
    }
    if (image.tagName === 'CANVAS') {
      await new Promise((resolve) => {
        image.toBlob(async (blob) => {
          data = await readFromBlobOrFile(blob);
          resolve();
        });
      });
    }
  } else if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    const blob = await image.convertToBlob();
    data = await readFromBlobOrFile(blob);
  } else if (image instanceof File || image instanceof Blob) {
    data = await readFromBlobOrFile(image);
  }

  return new Uint8Array(data);
};

module.exports = loadImage;

};
__m[21]=function(module,exports){var require=function(r){return __r({"./createWorker":6}[r]);};
const createWorker = require('./createWorker');

const recognize = async (image, langs, options) => {
  const worker = await createWorker(langs, 1, options);
  return worker.recognize(image)
    .finally(async () => {
      await worker.terminate();
    });
};

const detect = async (image, options) => {
  const worker = await createWorker('osd', 0, options);
  return worker.detect(image)
    .finally(async () => {
      await worker.terminate();
    });
};

module.exports = {
  recognize,
  detect,
};

};
__m[22]=function(module,exports){var require=function(r){return __r({}[r]);};
/*
 * languages with existing tesseract traineddata
 * https://tesseract-ocr.github.io/tessdoc/Data-Files#data-files-for-version-400-november-29-2016
 */

/**
 * @typedef {object} Languages
 * @property {string} AFR Afrikaans
 * @property {string} AMH Amharic
 * @property {string} ARA Arabic
 * @property {string} ASM Assamese
 * @property {string} AZE Azerbaijani
 * @property {string} AZE_CYRL Azerbaijani - Cyrillic
 * @property {string} BEL Belarusian
 * @property {string} BEN Bengali
 * @property {string} BOD Tibetan
 * @property {string} BOS Bosnian
 * @property {string} BUL Bulgarian
 * @property {string} CAT Catalan; Valencian
 * @property {string} CEB Cebuano
 * @property {string} CES Czech
 * @property {string} CHI_SIM Chinese - Simplified
 * @property {string} CHI_TRA Chinese - Traditional
 * @property {string} CHR Cherokee
 * @property {string} CYM Welsh
 * @property {string} DAN Danish
 * @property {string} DEU German
 * @property {string} DZO Dzongkha
 * @property {string} ELL Greek, Modern (1453-)
 * @property {string} ENG English
 * @property {string} ENM English, Middle (1100-1500)
 * @property {string} EPO Esperanto
 * @property {string} EST Estonian
 * @property {string} EUS Basque
 * @property {string} FAS Persian
 * @property {string} FIN Finnish
 * @property {string} FRA French
 * @property {string} FRK German Fraktur
 * @property {string} FRM French, Middle (ca. 1400-1600)
 * @property {string} GLE Irish
 * @property {string} GLG Galician
 * @property {string} GRC Greek, Ancient (-1453)
 * @property {string} GUJ Gujarati
 * @property {string} HAT Haitian; Haitian Creole
 * @property {string} HEB Hebrew
 * @property {string} HIN Hindi
 * @property {string} HRV Croatian
 * @property {string} HUN Hungarian
 * @property {string} IKU Inuktitut
 * @property {string} IND Indonesian
 * @property {string} ISL Icelandic
 * @property {string} ITA Italian
 * @property {string} ITA_OLD Italian - Old
 * @property {string} JAV Javanese
 * @property {string} JPN Japanese
 * @property {string} KAN Kannada
 * @property {string} KAT Georgian
 * @property {string} KAT_OLD Georgian - Old
 * @property {string} KAZ Kazakh
 * @property {string} KHM Central Khmer
 * @property {string} KIR Kirghiz; Kyrgyz
 * @property {string} KOR Korean
 * @property {string} KUR Kurdish
 * @property {string} LAO Lao
 * @property {string} LAT Latin
 * @property {string} LAV Latvian
 * @property {string} LIT Lithuanian
 * @property {string} MAL Malayalam
 * @property {string} MAR Marathi
 * @property {string} MKD Macedonian
 * @property {string} MLT Maltese
 * @property {string} MSA Malay
 * @property {string} MYA Burmese
 * @property {string} NEP Nepali
 * @property {string} NLD Dutch; Flemish
 * @property {string} NOR Norwegian
 * @property {string} ORI Oriya
 * @property {string} PAN Panjabi; Punjabi
 * @property {string} POL Polish
 * @property {string} POR Portuguese
 * @property {string} PUS Pushto; Pashto
 * @property {string} RON Romanian; Moldavian; Moldovan
 * @property {string} RUS Russian
 * @property {string} SAN Sanskrit
 * @property {string} SIN Sinhala; Sinhalese
 * @property {string} SLK Slovak
 * @property {string} SLV Slovenian
 * @property {string} SPA Spanish; Castilian
 * @property {string} SPA_OLD Spanish; Castilian - Old
 * @property {string} SQI Albanian
 * @property {string} SRP Serbian
 * @property {string} SRP_LATN Serbian - Latin
 * @property {string} SWA Swahili
 * @property {string} SWE Swedish
 * @property {string} SYR Syriac
 * @property {string} TAM Tamil
 * @property {string} TEL Telugu
 * @property {string} TGK Tajik
 * @property {string} TGL Tagalog
 * @property {string} THA Thai
 * @property {string} TIR Tigrinya
 * @property {string} TUR Turkish
 * @property {string} UIG Uighur; Uyghur
 * @property {string} UKR Ukrainian
 * @property {string} URD Urdu
 * @property {string} UZB Uzbek
 * @property {string} UZB_CYRL Uzbek - Cyrillic
 * @property {string} VIE Vietnamese
 * @property {string} YID Yiddish
 */

/**
  * @type {Languages}
  */
module.exports = {
  AFR: 'afr',
  AMH: 'amh',
  ARA: 'ara',
  ASM: 'asm',
  AZE: 'aze',
  AZE_CYRL: 'aze_cyrl',
  BEL: 'bel',
  BEN: 'ben',
  BOD: 'bod',
  BOS: 'bos',
  BUL: 'bul',
  CAT: 'cat',
  CEB: 'ceb',
  CES: 'ces',
  CHI_SIM: 'chi_sim',
  CHI_TRA: 'chi_tra',
  CHR: 'chr',
  CYM: 'cym',
  DAN: 'dan',
  DEU: 'deu',
  DZO: 'dzo',
  ELL: 'ell',
  ENG: 'eng',
  ENM: 'enm',
  EPO: 'epo',
  EST: 'est',
  EUS: 'eus',
  FAS: 'fas',
  FIN: 'fin',
  FRA: 'fra',
  FRK: 'frk',
  FRM: 'frm',
  GLE: 'gle',
  GLG: 'glg',
  GRC: 'grc',
  GUJ: 'guj',
  HAT: 'hat',
  HEB: 'heb',
  HIN: 'hin',
  HRV: 'hrv',
  HUN: 'hun',
  IKU: 'iku',
  IND: 'ind',
  ISL: 'isl',
  ITA: 'ita',
  ITA_OLD: 'ita_old',
  JAV: 'jav',
  JPN: 'jpn',
  KAN: 'kan',
  KAT: 'kat',
  KAT_OLD: 'kat_old',
  KAZ: 'kaz',
  KHM: 'khm',
  KIR: 'kir',
  KOR: 'kor',
  KUR: 'kur',
  LAO: 'lao',
  LAT: 'lat',
  LAV: 'lav',
  LIT: 'lit',
  MAL: 'mal',
  MAR: 'mar',
  MKD: 'mkd',
  MLT: 'mlt',
  MSA: 'msa',
  MYA: 'mya',
  NEP: 'nep',
  NLD: 'nld',
  NOR: 'nor',
  ORI: 'ori',
  PAN: 'pan',
  POL: 'pol',
  POR: 'por',
  PUS: 'pus',
  RON: 'ron',
  RUS: 'rus',
  SAN: 'san',
  SIN: 'sin',
  SLK: 'slk',
  SLV: 'slv',
  SPA: 'spa',
  SPA_OLD: 'spa_old',
  SQI: 'sqi',
  SRP: 'srp',
  SRP_LATN: 'srp_latn',
  SWA: 'swa',
  SWE: 'swe',
  SYR: 'syr',
  TAM: 'tam',
  TEL: 'tel',
  TGK: 'tgk',
  TGL: 'tgl',
  THA: 'tha',
  TIR: 'tir',
  TUR: 'tur',
  UIG: 'uig',
  UKR: 'ukr',
  URD: 'urd',
  UZB: 'uzb',
  UZB_CYRL: 'uzb_cyrl',
  VIE: 'vie',
  YID: 'yid',
};

};
__m[23]=function(module,exports){var require=function(r){return __r({}[r]);};
/*
 * PSM = Page Segmentation Mode
 */
module.exports = {
  OSD_ONLY: '0',
  AUTO_OSD: '1',
  AUTO_ONLY: '2',
  AUTO: '3',
  SINGLE_COLUMN: '4',
  SINGLE_BLOCK_VERT_TEXT: '5',
  SINGLE_BLOCK: '6',
  SINGLE_LINE: '7',
  SINGLE_WORD: '8',
  CIRCLE_WORD: '9',
  SINGLE_CHAR: '10',
  SPARSE_TEXT: '11',
  SPARSE_TEXT_OSD: '12',
  RAW_LINE: '13',
};

};
var __e=__r(0);(typeof self!=="undefined"?self:window).Tesseract=__e;
})();
