(function(){var global=(typeof self!=="undefined"?self:window);var __m={},__c={};function __r(id){if(__c[id])return __c[id].exports;var m=__c[id]={exports:{}};__m[id](m,m.exports);return m.exports;}
__m[0]=function(module,exports){var require=function(r){return __r({"..":1,"./getCore":15,"./gunzip":18,"./cache":20}[r]);};
/**
 *
 * Browser worker scripts
 *
 * @fileoverview Browser worker implementation
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */

const worker = require('..');
const getCore = require('./getCore');
const gunzip = require('./gunzip');
const cache = require('./cache');

/*
 * register message handler
 */
global.addEventListener('message', ({ data }) => {
  worker.dispatchHandlers(data, (obj) => postMessage(obj));
});

/*
 * getCore is a sync function to load and return
 * TesseractCore.
 */
worker.setAdapter({
  getCore,
  gunzip,
  fetch: () => {},
  ...cache,
});

};
__m[1]=function(module,exports){var require=function(r){return __r({"regenerator-runtime/runtime":2,"is-url":3,"./utils/dump":4,"../utils/getEnvironment":7,"./utils/setImage":9,"./constants/defaultParams":11,"./constants/defaultOutput":13,"../utils/log":14,"../constants/PSM":12}[r]);};
/**
 *
 * Worker script for browser and node
 *
 * @fileoverview Worker script for browser and node
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */
require('regenerator-runtime/runtime');
const isURL = require('is-url');
const dump = require('./utils/dump');
const env = require('../utils/getEnvironment')('type');
const setImage = require('./utils/setImage');
const defaultParams = require('./constants/defaultParams');
const defaultOutput = require('./constants/defaultOutput');
const { log, setLogging } = require('../utils/log');
const PSM = require('../constants/PSM');

/*
 * Tesseract Module returned by TesseractCore.
 */
let TessModule;
/*
 * TessearctBaseAPI instance
 */
let api = null;
let latestJob;
let adapter = {};
let params = defaultParams;
let loadLanguageLangsWorker;
let loadLanguageOptionsWorker;
let dataFromCache = false;

const load = async ({ workerId, jobId, payload: { options: { lstmOnly, corePath, logging } } }, res) => { // eslint-disable-line max-len
  setLogging(logging);

  const statusText = 'initializing tesseract';

  if (!TessModule) {
    const Core = await adapter.getCore(lstmOnly, corePath, res);

    res.progress({ workerId, status: statusText, progress: 0 });

    Core({
      TesseractProgress(percent) {
        latestJob.progress({
          workerId,
          jobId,
          status: 'recognizing text',
          progress: Math.max(0, (percent - 30) / 70),
        });
      },
    }).then((tessModule) => {
      TessModule = tessModule;
      res.progress({ workerId, status: statusText, progress: 1 });
      res.resolve({ loaded: true });
    });
  } else {
    res.resolve({ loaded: true });
  }
};

const FS = async ({ workerId, payload: { method, args } }, res) => {
  log(`[${workerId}]: FS.${method}`);
  res.resolve(TessModule.FS[method](...args));
};

const loadLanguage = async ({
  workerId,
  payload: {
    langs,
    options: {
      langPath,
      dataPath,
      cachePath,
      cacheMethod,
      gzip = true,
      lstmOnly,
    },
  },
},
res) => {
  // Remember options for later, as cache may be deleted if `initialize` fails
  loadLanguageLangsWorker = langs;
  loadLanguageOptionsWorker = {
    langPath,
    dataPath,
    cachePath,
    cacheMethod,
    gzip,
    lstmOnly,
  };

  const statusText = 'loading language traineddata';

  const langsArr = typeof langs === 'string' ? langs.split('+') : langs;
  let progress = 0;

  const loadAndGunzipFile = async (_lang) => {
    const lang = typeof _lang === 'string' ? _lang : _lang.code;
    const readCache = ['refresh', 'none'].includes(cacheMethod)
      ? () => Promise.resolve()
      : adapter.readCache;
    let data = null;
    let newData = false;

    // Check for existing .traineddata file in cache
    // This automatically fails if cacheMethod is set to 'refresh' or 'none'
    try {
      const _data = await readCache(`${cachePath || '.'}/${lang}.traineddata`);
      if (typeof _data !== 'undefined') {
        log(`[${workerId}]: Load ${lang}.traineddata from cache`);
        data = _data;
        dataFromCache = true;
      } else {
        throw Error('Not found in cache');
      }
    // Attempt to fetch new .traineddata file
    } catch (e) {
      newData = true;
      log(`[${workerId}]: Load ${lang}.traineddata from ${langPath}`);
      if (typeof _lang === 'string') {
        let path = null;

        // If `langPath` if not explicitly set by the user, the jsdelivr CDN is used.
        // Data supporting the Legacy model is only included if `lstmOnly` is not true.
        // This saves a significant amount of data for the majority of users that use LSTM only.
        const langPathDownload = langPath || (lstmOnly ? `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int` : `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0`);

        // For Node.js, langPath may be a URL or local file path
        // The is-url package is used to tell the difference
        // For the browser version, langPath is assumed to be a URL
        if (env !== 'node' || isURL(langPathDownload) || langPathDownload.startsWith('moz-extension://') || langPathDownload.startsWith('chrome-extension://') || langPathDownload.startsWith('file://')) { /** When langPathDownload is an URL */
          path = langPathDownload.replace(/\/$/, '');
        }

        // langPathDownload is a URL, fetch from server
        if (path !== null) {
          const fetchUrl = `${path}/${lang}.traineddata${gzip ? '.gz' : ''}`;
          const resp = await (env === 'webworker' ? fetch : adapter.fetch)(fetchUrl);
          if (!resp.ok) {
            throw Error(`Network error while fetching ${fetchUrl}. Response code: ${resp.status}`);
          }
          data = new Uint8Array(await resp.arrayBuffer());

        // langPathDownload is a local file, read .traineddata from local filesystem
        // (adapter.readCache is a generic file read function in Node.js version)
        } else {
          data = await adapter.readCache(`${langPathDownload}/${lang}.traineddata${gzip ? '.gz' : ''}`);
        }
      } else {
        data = _lang.data; // eslint-disable-line
      }
    }

    progress += 0.5 / langsArr.length;
    if (res) res.progress({ workerId, status: statusText, progress });

    // Check for gzip magic numbers (1F and 8B in hex)
    const isGzip = (data[0] === 31 && data[1] === 139) || (data[1] === 31 && data[0] === 139);

    if (isGzip) {
      data = adapter.gunzip(data);
    }

    if (TessModule) {
      if (dataPath) {
        try {
          TessModule.FS.mkdir(dataPath);
        } catch (err) {
          if (res) res.reject(err.toString());
        }
      }
      TessModule.FS.writeFile(`${dataPath || '.'}/${lang}.traineddata`, data);
    }

    if (newData && ['write', 'refresh', undefined].includes(cacheMethod)) {
      try {
        await adapter.writeCache(`${cachePath || '.'}/${lang}.traineddata`, data);
      } catch (err) {
        log(`[${workerId}]: Failed to write ${lang}.traineddata to cache due to error:`);
        log(err.toString());
      }
    }

    progress += 0.5 / langsArr.length;
    // Make sure last progress message is 1 (not 0.9999)
    if (Math.round(progress * 100) === 100) progress = 1;
    if (res) res.progress({ workerId, status: statusText, progress });
  };

  if (res) res.progress({ workerId, status: statusText, progress: 0 });
  try {
    await Promise.all(langsArr.map(loadAndGunzipFile));
    if (res) res.resolve(langs);
  } catch (err) {
    if (res) res.reject(err.toString());
  }
};

const setParameters = async ({ payload: { params: _params } }, res) => {
  // A small number of parameters can only be set at initialization.
  // These can only be set using (1) the `oem` argument of `initialize` (for setting the oem)
  // or (2) the `config` argument of `initialize` (for all other settings).
  // Attempting to set these using this function will have no impact so a warning is printed.
  // This list is generated by searching the Tesseract codebase for parameters
  // defined with `[type]_INIT_MEMBER` rather than `[type]_MEMBER`.
  const initParamNames = ['ambigs_debug_level', 'user_words_suffix', 'user_patterns_suffix', 'user_patterns_suffix',
    'load_system_dawg', 'load_freq_dawg', 'load_unambig_dawg', 'load_punc_dawg', 'load_number_dawg', 'load_bigram_dawg',
    'tessedit_ocr_engine_mode', 'tessedit_init_config_only', 'language_model_ngram_on', 'language_model_use_sigmoidal_certainty'];

  const initParamStr = Object.keys(_params)
    .filter((k) => initParamNames.includes(k))
    .join(', ');

  if (initParamStr.length > 0) console.log(`Attempted to set parameters that can only be set during initialization: ${initParamStr}`);

  Object.keys(_params)
    .filter((k) => !k.startsWith('tessjs_'))
    .forEach((key) => {
      api.SetVariable(key, _params[key]);
    });
  params = { ...params, ..._params };

  if (typeof res !== 'undefined') {
    res.resolve(params);
  }
};

const initialize = async ({
  workerId,
  payload: { langs: _langs, oem, config },
}, res) => {
  const langs = (typeof _langs === 'string')
    ? _langs
    : _langs.map((l) => ((typeof l === 'string') ? l : l.data)).join('+');

  const statusText = 'initializing api';

  try {
    res.progress({
      workerId, status: statusText, progress: 0,
    });
    if (api !== null) {
      api.End();
    }
    let configFile;
    let configStr;
    // config argument may either be config file text, or object with key/value pairs
    // In the latter case we convert to config file text here
    if (config && typeof config === 'object' && Object.keys(config).length > 0) {
      configStr = JSON.stringify(config).replace(/,/g, '\n').replace(/:/g, ' ').replace(/["'{}]/g, '');
    } else if (config && typeof config === 'string') {
      configStr = config;
    }
    if (typeof configStr === 'string') {
      configFile = '/config';
      TessModule.FS.writeFile(configFile, configStr);
    }

    api = new TessModule.TessBaseAPI();
    let status = api.Init(null, langs, oem, configFile);
    if (status === -1) {
      // Cache is deleted if initialization fails to avoid keeping bad data in cache
      // This assumes that initialization failing only occurs due to bad .traineddata,
      // this should be refined if other reasons for init failing are encountered.
      // The "if" condition skips this section if either (1) cache is disabled [so the issue
      // is definitely unrelated to cached data] or (2) cache is set to read-only
      // [so we do not have permission to make any changes].
      if (['write', 'refresh', undefined].includes(loadLanguageOptionsWorker.cacheMethod)) {
        const langsArr = langs.split('+');
        const delCachePromise = langsArr.map((lang) => adapter.deleteCache(`${loadLanguageOptionsWorker.cachePath || '.'}/${lang}.traineddata`));
        await Promise.all(delCachePromise);

        // Check for the case when (1) data was loaded from the cache and
        // (2) the data does not support the requested OEM.
        // In this case, loadLanguage is re-run and initialization is attempted a second time.
        // This is because `loadLanguage` has no mechanism for checking whether the cached data
        // supports the requested model, so this only becomes apparent when initialization fails.

        // Check for this error message:
        // eslint-disable-next-line
        // "Tesseract (legacy) engine requested, but components are not present in ./eng.traineddata!!""
        // The .wasm build of Tesseract saves this message in a separate file
        // (in addition to the normal debug file location).
        const debugStr = TessModule.FS.readFile('/debugDev.txt', { encoding: 'utf8', flags: 'a+' });
        if (dataFromCache && /components are not present/.test(debugStr)) {
          log('Data from cache missing requested OEM model. Attempting to refresh cache with new language data.');
          // In this case, language data is re-loaded
          await loadLanguage({ workerId, payload: { langs: loadLanguageLangsWorker, options: loadLanguageOptionsWorker } }); // eslint-disable-line max-len
          status = api.Init(null, langs, oem, configFile);
          if (status === -1) {
            log('Language data refresh failed.');
            const delCachePromise2 = langsArr.map((lang) => adapter.deleteCache(`${loadLanguageOptionsWorker.cachePath || '.'}/${lang}.traineddata`));
            await Promise.all(delCachePromise2);
          } else {
            log('Language data refresh successful.');
          }
        }
      }
    }

    if (status === -1) {
      res.reject('initialization failed');
    }

    params = defaultParams;
    await setParameters({ payload: { params } });
    res.progress({
      workerId, status: statusText, progress: 1,
    });
    res.resolve();
  } catch (err) {
    res.reject(err.toString());
  }
};

const getPDFInternal = (title, textonly) => {
  const pdfRenderer = new TessModule.TessPDFRenderer('tesseract-ocr', '/', textonly);
  pdfRenderer.BeginDocument(title);
  pdfRenderer.AddImage(api);
  pdfRenderer.EndDocument();
  TessModule._free(pdfRenderer);

  return TessModule.FS.readFile('/tesseract-ocr.pdf');
};

const getPDF = async ({ payload: { title, textonly } }, res) => {
  res.resolve(getPDFInternal(title, textonly));
};

// Combines default output with user-specified options and
// counts (1) total output formats requested and (2) outputs that require OCR
const processOutput = (output) => {
  const workingOutput = JSON.parse(JSON.stringify(defaultOutput));
  // Output formats were set using `setParameters` in previous versions
  // These settings are copied over for compatability
  if (params.tessjs_create_box === '1') workingOutput.box = true;
  if (params.tessjs_create_hocr === '1') workingOutput.hocr = true;
  if (params.tessjs_create_osd === '1') workingOutput.osd = true;
  if (params.tessjs_create_tsv === '1') workingOutput.tsv = true;
  if (params.tessjs_create_unlv === '1') workingOutput.unlv = true;

  const nonRecOutputs = ['imageColor', 'imageGrey', 'imageBinary', 'layoutBlocks', 'debug'];
  let recOutputCount = 0;
  for (const prop of Object.keys(output)) {
    workingOutput[prop] = output[prop];
  }
  for (const prop of Object.keys(workingOutput)) {
    if (workingOutput[prop]) {
      if (!nonRecOutputs.includes(prop)) {
        recOutputCount += 1;
      }
    }
  }
  const skipRecognition = recOutputCount === 0;
  return { workingOutput, skipRecognition };
};

// List of options for Tesseract.js (rather than passed through to Tesseract),
// not including those with prefix "tessjs_"
const tessjsOptions = ['rectangle', 'pdfTitle', 'pdfTextOnly', 'rotateAuto', 'rotateRadians'];

const recognize = async ({
  payload: {
    image, options, output,
  },
}, res) => {
  try {
    const optionsTess = {};
    if (typeof options === 'object' && Object.keys(options).length > 0) {
      // The options provided by users contain a mix of options for Tesseract.js
      // and parameters passed through to Tesseract.
      for (const param of Object.keys(options)) {
        if (!param.startsWith('tessjs_') && !tessjsOptions.includes(param)) {
          optionsTess[param] = options[param];
        }
      }
    }
    if (output.debug) {
      optionsTess.debug_file = '/debugInternal.txt';
      TessModule.FS.writeFile('/debugInternal.txt', '');
    }
    // If any parameters are changed here they are changed back at the end
    if (Object.keys(optionsTess).length > 0) {
      api.SaveParameters();
      for (const prop of Object.keys(optionsTess)) {
        api.SetVariable(prop, optionsTess[prop]);
      }
    }

    const { workingOutput, skipRecognition } = processOutput(output);

    // When the auto-rotate option is True, setImage is called with no angle,
    // then the angle is calculated by Tesseract and then setImage is re-called.
    // Otherwise, setImage is called once using the user-provided rotateRadiansFinal value.
    let rotateRadiansFinal;
    if (options.rotateAuto) {
      // The angle is only detected if auto page segmentation is used
      // Therefore, if this is not the mode specified by the user, it is enabled temporarily here
      const psmInit = api.GetPageSegMode();
      let psmEdit = false;
      if (![PSM.AUTO, PSM.AUTO_ONLY, PSM.OSD].includes(String(psmInit))) {
        psmEdit = true;
        api.SetVariable('tessedit_pageseg_mode', String(PSM.AUTO));
      }

      setImage(TessModule, api, image);
      api.FindLines();

      // The function GetAngle will be replaced with GetGradient in 4.0.4,
      // but for now we want to maintain compatibility.
      // We can switch to only using GetGradient in v5.
      const rotateRadiansCalc = api.GetGradient ? api.GetGradient() : api.GetAngle();

      // Restore user-provided PSM setting
      if (psmEdit) {
        api.SetVariable('tessedit_pageseg_mode', String(psmInit));
      }

      // Small angles (<0.005 radians/~0.3 degrees) are ignored to save on runtime
      if (Math.abs(rotateRadiansCalc) >= 0.005) {
        rotateRadiansFinal = rotateRadiansCalc;
        setImage(TessModule, api, image, rotateRadiansFinal);
      } else {
        // Image needs to be reset if run with different PSM setting earlier
        if (psmEdit) {
          setImage(TessModule, api, image);
        }
        rotateRadiansFinal = 0;
      }
    } else {
      rotateRadiansFinal = options.rotateRadians || 0;
      setImage(TessModule, api, image, rotateRadiansFinal);
    }

    const rec = options.rectangle;
    if (typeof rec === 'object') {
      api.SetRectangle(rec.left, rec.top, rec.width, rec.height);
    }

    if (!skipRecognition) {
      api.Recognize(null);
    } else {
      if (output.layoutBlocks) {
        api.AnalyseLayout();
      }
      log('Skipping recognition: all output options requiring recognition are disabled.');
    }
    const { pdfTitle } = options;
    const { pdfTextOnly } = options;
    const result = dump(TessModule, api, workingOutput, { pdfTitle, pdfTextOnly, skipRecognition });
    result.rotateRadians = rotateRadiansFinal;

    if (output.debug) TessModule.FS.unlink('/debugInternal.txt');

    if (Object.keys(optionsTess).length > 0) {
      api.RestoreParameters();
    }

    res.resolve(result);
  } catch (err) {
    res.reject(err.toString());
  }
};

const detect = async ({ payload: { image } }, res) => {
  try {
    setImage(TessModule, api, image);
    const results = new TessModule.OSResults();

    if (!api.DetectOS(results)) {
      res.resolve({
        tesseract_script_id: null,
        script: null,
        script_confidence: null,
        orientation_degrees: null,
        orientation_confidence: null,
      });
    } else {
      const best = results.best_result;
      const oid = best.orientation_id;
      const sid = best.script_id;

      res.resolve({
        tesseract_script_id: sid,
        script: results.unicharset.get_script_from_script_id(sid),
        script_confidence: best.sconfidence,
        orientation_degrees: [0, 270, 180, 90][oid],
        orientation_confidence: best.oconfidence,
      });
    }
  } catch (err) {
    res.reject(err.toString());
  }
};

const terminate = async (_, res) => {
  try {
    if (api !== null) {
      api.End();
    }
    res.resolve({ terminated: true });
  } catch (err) {
    res.reject(err.toString());
  }
};

/**
 * dispatchHandlers
 *
 * @name dispatchHandlers
 * @function worker data handler
 * @access public
 * @param {object} data
 * @param {string} data.jobId - unique job id
 * @param {string} data.action - action of the job, only recognize and detect for now
 * @param {object} data.payload - data for the job
 * @param {function} send - trigger job to work
 */
exports.dispatchHandlers = (packet, send) => {
  const res = (status, data) => {
    // Return only the necessary info to avoid sending unnecessarily large messages
    const packetRes = {
      jobId: packet.jobId,
      workerId: packet.workerId,
      action: packet.action,
    };
    send({
      ...packetRes,
      status,
      data,
    });
  };
  res.resolve = res.bind(this, 'resolve');
  res.reject = res.bind(this, 'reject');
  res.progress = res.bind(this, 'progress');

  latestJob = res;

  ({
    load,
    FS,
    loadLanguage,
    initialize,
    setParameters,
    recognize,
    getPDF,
    detect,
    terminate,
  })[packet.action](packet, res)
    .catch((err) => res.reject(err.toString()));
};

/**
 * setAdapter
 *
 * @name setAdapter
 * @function
 * @access public
 * @param {object} adapter - implementation of the worker, different in browser and node environment
 */
exports.setAdapter = (_adapter) => {
  adapter = _adapter;
};

};
__m[2]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports={};
};
__m[3]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports=function(s){return /^(https?|file):/.test(String(s));};
};
__m[4]=function(module,exports){var require=function(r){return __r({"./arrayBufferToBase64":5,"../../constants/imageType":6}[r]);};
/**
 *
 * Dump data to a big JSON tree
 *
 * @fileoverview dump data to JSON tree
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */
const arrayBufferToBase64 = require('./arrayBufferToBase64');
const imageType = require('../../constants/imageType');

/**
 * deindent
 *
 * The generated HOCR is excessively indented, so
 * we get rid of that indentation
 *
 * @name deindent
 * @function deindent string
 * @access public
 */
const deindent = (html) => {
  const lines = html.split('\n');
  if (lines[0].substring(0, 2) === '  ') {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].substring(0, 2) === '  ') {
        lines[i] = lines[i].slice(2);
      }
    }
  }
  return lines.join('\n');
};

/**
 * dump
 *
 * @name dump
 * @function dump recognition result to a JSON object
 * @access public
 */
module.exports = (TessModule, api, output, options) => {
  const ri = api.GetIterator();
  const {
    RIL_BLOCK,
    RIL_PARA,
    RIL_TEXTLINE,
    RIL_WORD,
    RIL_SYMBOL,
  } = TessModule;
  const blocks = [];
  let block;
  let para;
  let textline;
  let word;
  let symbol;

  const enumToString = (value, prefix) => (
    Object.keys(TessModule)
      .filter((e) => (e.startsWith(`${prefix}_`) && TessModule[e] === value))
      .map((e) => e.slice(prefix.length + 1))[0]
  );

  const getImage = (type) => {
    api.WriteImage(type, '/image.png');
    const pngBuffer = TessModule.FS.readFile('/image.png');
    const pngStr = `data:image/png;base64,${arrayBufferToBase64(pngBuffer.buffer)}`;
    TessModule.FS.unlink('/image.png');
    return pngStr;
  };

  const getPDFInternal = (title, textonly) => {
    const pdfRenderer = new TessModule.TessPDFRenderer('tesseract-ocr', '/', textonly);
    pdfRenderer.BeginDocument(title);
    pdfRenderer.AddImage(api);
    pdfRenderer.EndDocument();
    TessModule._free(pdfRenderer);

    return TessModule.FS.readFile('/tesseract-ocr.pdf');
  };

  // If output.layoutBlocks is true and options.skipRecognition is true,
  // the user wants layout data but text recognition has not been run.
  // In this case, fields that require text recognition are skipped.
  if (output.blocks || output.layoutBlocks) {
    ri.Begin();
    do {
      if (ri.IsAtBeginningOf(RIL_BLOCK)) {
        const poly = ri.BlockPolygon();
        let polygon = null;
        // BlockPolygon() returns null when automatic page segmentation is off
        if (TessModule.getPointer(poly) > 0) {
          const n = poly.get_n();
          const px = poly.get_x();
          const py = poly.get_y();
          polygon = [];
          for (let i = 0; i < n; i += 1) {
            polygon.push([px.getValue(i), py.getValue(i)]);
          }
          /*
           * TODO: find out why _ptaDestroy doesn't work
           */
          // TessModule._ptaDestroy(TessModule.getPointer(poly));
        }

        block = {
          paragraphs: [],
          text: !options.skipRecognition ? ri.GetUTF8Text(RIL_BLOCK) : null,
          confidence: !options.skipRecognition ? ri.Confidence(RIL_BLOCK) : null,
          baseline: ri.getBaseline(RIL_BLOCK),
          bbox: ri.getBoundingBox(RIL_BLOCK),
          blocktype: enumToString(ri.BlockType(), 'PT'),
          polygon,
        };
        blocks.push(block);
      }
      if (ri.IsAtBeginningOf(RIL_PARA)) {
        para = {
          lines: [],
          text: !options.skipRecognition ? ri.GetUTF8Text(RIL_PARA) : null,
          confidence: !options.skipRecognition ? ri.Confidence(RIL_PARA) : null,
          baseline: ri.getBaseline(RIL_PARA),
          bbox: ri.getBoundingBox(RIL_PARA),
          is_ltr: !!ri.ParagraphIsLtr(),
        };
        block.paragraphs.push(para);
      }
      if (ri.IsAtBeginningOf(RIL_TEXTLINE)) {
        // getRowAttributes was added in a recent minor version of Tesseract.js-core,
        // so we need to check if it exists before calling it.
        // This can be removed in the next major version (v6).
        let rowAttributes;
        if (ri.getRowAttributes) {
          rowAttributes = ri.getRowAttributes();
          // Descenders is reported as a negative within Tesseract internally so we need to flip it.
          // The positive version is intuitive, and matches what is reported in the hOCR output.
          rowAttributes.descenders *= -1;
        }
        textline = {
          words: [],
          text: !options.skipRecognition ? ri.GetUTF8Text(RIL_TEXTLINE) : null,
          confidence: !options.skipRecognition ? ri.Confidence(RIL_TEXTLINE) : null,
          baseline: ri.getBaseline(RIL_TEXTLINE),
          rowAttributes,
          bbox: ri.getBoundingBox(RIL_TEXTLINE),
        };
        para.lines.push(textline);
      }
      if (ri.IsAtBeginningOf(RIL_WORD)) {
        const fontInfo = ri.getWordFontAttributes();
        const wordDir = ri.WordDirection();
        word = {
          symbols: [],
          choices: [],

          text: !options.skipRecognition ? ri.GetUTF8Text(RIL_WORD) : null,
          confidence: !options.skipRecognition ? ri.Confidence(RIL_WORD) : null,
          baseline: ri.getBaseline(RIL_WORD),
          bbox: ri.getBoundingBox(RIL_WORD),

          is_numeric: !!ri.WordIsNumeric(),
          in_dictionary: !!ri.WordIsFromDictionary(),
          direction: enumToString(wordDir, 'DIR'),
          language: ri.WordRecognitionLanguage(),

          is_bold: fontInfo.is_bold,
          is_italic: fontInfo.is_italic,
          is_underlined: fontInfo.is_underlined,
          is_monospace: fontInfo.is_monospace,
          is_serif: fontInfo.is_serif,
          is_smallcaps: fontInfo.is_smallcaps,
          font_size: fontInfo.pointsize,
          font_id: fontInfo.font_id,
          font_name: fontInfo.font_name,
        };
        const wc = new TessModule.WordChoiceIterator(ri);
        do {
          word.choices.push({
            text: !options.skipRecognition ? wc.GetUTF8Text() : null,
            confidence: !options.skipRecognition ? wc.Confidence() : null,
          });
        } while (wc.Next());
        TessModule.destroy(wc);
        textline.words.push(word);
      }

      // let image = null;
      // var pix = ri.GetBinaryImage(TessModule.RIL_SYMBOL)
      // var image = pix2array(pix);
      // // for some reason it seems that things stop working if you destroy pics
      // TessModule._pixDestroy(TessModule.getPointer(pix));
      if (ri.IsAtBeginningOf(RIL_SYMBOL)) {
        symbol = {
          choices: [],
          image: null,
          text: !options.skipRecognition ? ri.GetUTF8Text(RIL_SYMBOL) : null,
          confidence: !options.skipRecognition ? ri.Confidence(RIL_SYMBOL) : null,
          baseline: ri.getBaseline(RIL_SYMBOL),
          bbox: ri.getBoundingBox(RIL_SYMBOL),
          is_superscript: !!ri.SymbolIsSuperscript(),
          is_subscript: !!ri.SymbolIsSubscript(),
          is_dropcap: !!ri.SymbolIsDropcap(),
        };
        word.symbols.push(symbol);
        const ci = new TessModule.ChoiceIterator(ri);
        do {
          symbol.choices.push({
            text: !options.skipRecognition ? ci.GetUTF8Text() : null,
            confidence: !options.skipRecognition ? ci.Confidence() : null,
          });
        } while (ci.Next());
        // TessModule.destroy(i);
      }
    } while (ri.Next(RIL_SYMBOL));
    TessModule.destroy(ri);
  }

  return {
    text: output.text ? api.GetUTF8Text() : null,
    hocr: output.hocr ? deindent(api.GetHOCRText()) : null,
    tsv: output.tsv ? api.GetTSVText() : null,
    box: output.box ? api.GetBoxText() : null,
    unlv: output.unlv ? api.GetUNLVText() : null,
    osd: output.osd ? api.GetOsdText() : null,
    pdf: output.pdf ? getPDFInternal(options.pdfTitle ?? 'Tesseract OCR Result', options.pdfTextOnly ?? false) : null,
    imageColor: output.imageColor ? getImage(imageType.COLOR) : null,
    imageGrey: output.imageGrey ? getImage(imageType.GREY) : null,
    imageBinary: output.imageBinary ? getImage(imageType.BINARY) : null,
    confidence: !options.skipRecognition ? api.MeanTextConf() : null,
    blocks: output.blocks && !options.skipRecognition ? blocks : null,
    layoutBlocks: output.layoutBlocks && options.skipRecognition ? blocks : null,
    psm: enumToString(api.GetPageSegMode(), 'PSM'),
    oem: enumToString(api.oem(), 'OEM'),
    version: api.Version(),
    debug: output.debug ? TessModule.FS.readFile('/debugInternal.txt', { encoding: 'utf8', flags: 'a+' }) : null,
  };
};

};
__m[5]=function(module,exports){var require=function(r){return __r({}[r]);};
// Copied from https://gist.github.com/jonleighton/958841
// Copyright 2011 Jon Leighton, MIT LICENSE

/* eslint no-bitwise: 0 */
module.exports = (arrayBuffer) => {
  let base64 = '';
  const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  const bytes = new Uint8Array(arrayBuffer);
  const { byteLength } = bytes;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a; let b; let c; let
    d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i += 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032     = (2^6 - 1) << 6
    d = chunk & 63; // 63       = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3   = 2^2 - 1

    base64 += `${encodings[a] + encodings[b]}==`;
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008  = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15    = 2^4 - 1

    base64 += `${encodings[a] + encodings[b] + encodings[c]}=`;
  }

  return base64;
};

};
__m[6]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports = {
  COLOR: 0,
  GREY: 1,
  BINARY: 2,
};

};
__m[7]=function(module,exports){var require=function(r){return __r({"is-electron":8}[r]);};
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
__m[8]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports=function(){return false;};
};
__m[9]=function(module,exports){var require=function(r){return __r({"bmp-js":10}[r]);};
const bmp = require('bmp-js');

/**
 * setImage
 *
 * @name setImage
 * @function set image in tesseract for recognition
 * @access public
 */
module.exports = (TessModule, api, image, angle = 0) => {
  // Check for bmp magic numbers (42 and 4D in hex)
  const isBmp = (image[0] === 66 && image[1] === 77) || (image[1] === 66 && image[0] === 77);

  const exif = parseInt(image.slice(0, 500).join(' ').match(/1 18 0 3 0 0 0 1 0 (\d)/)?.[1], 10) || 1;

  // /*
  //  * Leptonica supports some but not all bmp files
  //  * @see https://github.com/DanBloomberg/leptonica/issues/607#issuecomment-1068802516
  //  * We therefore use bmp-js to convert all bmp files into a format Leptonica is known to support
  //  */
  if (isBmp) {
    // Not sure what this line actually does, but removing breaks the function
    const buf = Buffer.from(Array.from({ ...image, length: Object.keys(image).length }));
    const bmpBuf = bmp.decode(buf);
    TessModule.FS.writeFile('/input', bmp.encode(bmpBuf).data);
  } else {
    TessModule.FS.writeFile('/input', image);
  }

  const res = api.SetImageFile(exif, angle);
  if (res === 1) throw Error('Error attempting to read image.');
};

};
__m[10]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports={decode:function(){throw Error("bmp non supporté")},encode:function(){throw Error("bmp non supporté")}};
};
__m[11]=function(module,exports){var require=function(r){return __r({"../../constants/PSM":12}[r]);};
/*
 * default params for tesseract.js
 */
const PSM = require('../../constants/PSM');

module.exports = {
  tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  tessedit_char_whitelist: '',
  tessjs_create_hocr: '1',
  tessjs_create_tsv: '1',
  tessjs_create_box: '0',
  tessjs_create_unlv: '0',
  tessjs_create_osd: '0',
};

};
__m[12]=function(module,exports){var require=function(r){return __r({}[r]);};
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
__m[13]=function(module,exports){var require=function(r){return __r({}[r]);};
/*
 * default output formats for tesseract.js
 */

module.exports = {
  text: true,
  blocks: true,
  layoutBlocks: false,
  hocr: true,
  tsv: true,
  box: false,
  unlv: false,
  osd: false,
  pdf: false,
  imageColor: false,
  imageGrey: false,
  imageBinary: false,
  debug: false,
};

};
__m[14]=function(module,exports){var require=function(r){return __r({}[r]);};
let logging = false;

exports.logging = logging;

exports.setLogging = (_logging) => {
  logging = _logging;
};

exports.log = (...args) => (logging ? console.log.apply(this, args) : null);

};
__m[15]=function(module,exports){var require=function(r){return __r({"wasm-feature-detect":16,"../../../package.json":17}[r]);};
const { simd } = require('wasm-feature-detect');
const coreVersion = require('../../../package.json').dependencies['tesseract.js-core'];

module.exports = async (lstmOnly, corePath, res) => {
  if (typeof global.TesseractCore === 'undefined') {
    const statusText = 'loading tesseract core';

    res.progress({ status: statusText, progress: 0 });

    // If the user specifies a core path, we use that
    // Otherwise, default to CDN
    const corePathImport = corePath || `https://cdn.jsdelivr.net/npm/tesseract.js-core@v${coreVersion.substring(1)}`;

    // If a user specifies a specific JavaScript file, load that file.
    // Otherwise, assume a directory has been provided, and load either
    // tesseract-core.wasm.js or tesseract-core-simd.wasm.js depending
    // on whether this device has SIMD support.
    let corePathImportFile;
    if (corePathImport.slice(-2) === 'js') {
      corePathImportFile = corePathImport;
    } else {
      const simdSupport = await simd();
      if (simdSupport) {
        if (lstmOnly) {
          corePathImportFile = `${corePathImport.replace(/\/$/, '')}/tesseract-core-simd-lstm.wasm.js`;
        } else {
          corePathImportFile = `${corePathImport.replace(/\/$/, '')}/tesseract-core-simd.wasm.js`;
        }
      } else if (lstmOnly) {
        corePathImportFile = `${corePathImport.replace(/\/$/, '')}/tesseract-core-lstm.wasm.js`;
      } else {
        corePathImportFile = `${corePathImport.replace(/\/$/, '')}/tesseract-core.wasm.js`;
      }
    }

    // Create a module named `global.TesseractCore`
    global.importScripts(corePathImportFile);

    // Tesseract.js-core versions through 4.0.3 create a module named `global.TesseractCoreWASM`,
    // so we account for that here to preserve backwards compatibility.
    // This part can be removed when Tesseract.js-core v4.0.3 becomes incompatible for other reasons
    if (typeof global.TesseractCore === 'undefined' && typeof global.TesseractCoreWASM !== 'undefined' && typeof WebAssembly === 'object') {
      global.TesseractCore = global.TesseractCoreWASM;
    } else if (typeof global.TesseractCore === 'undefined') {
      throw Error('Failed to load TesseractCore');
    }
    res.progress({ status: statusText, progress: 1 });
  }
  return global.TesseractCore;
};

};
__m[16]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports={simd:async function(){try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));}catch(e){return false;}}};
};
__m[17]=function(module,exports){var require=function(r){return __r({}[r]);};
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
__m[18]=function(module,exports){var require=function(r){return __r({"zlibjs":19}[r]);};
module.exports = require('zlibjs').gunzipSync;

};
__m[19]=function(module,exports){var require=function(r){return __r({}[r]);};
module.exports={gunzipSync:function(){throw Error("gzip non supporté (données non compressées attendues)")}};
};
__m[20]=function(module,exports){var require=function(r){return __r({"idb-keyval":21}[r]);};
const { set, get, del } = require('idb-keyval');

module.exports = {
  readCache: get,
  writeCache: set,
  deleteCache: del,
  checkCache: (path) => (
    get(path).then((v) => typeof v !== 'undefined')
  ),
};

};
__m[21]=function(module,exports){var require=function(r){return __r({}[r]);};

var DB=null;function db(){return DB||(DB=new Promise(function(res,rej){var r=indexedDB.open('tml-ocr-kv',1);r.onupgradeneeded=function(){r.result.createObjectStore('kv')};r.onsuccess=function(){res(r.result)};r.onerror=function(){rej(r.error)};}));}
function tx(m,f){return db().then(function(d){return new Promise(function(res,rej){var t=d.transaction('kv',m),s=t.objectStore('kv'),q=f(s);t.oncomplete=function(){res(q&&q.result)};t.onerror=function(){rej(t.error)};});});}
module.exports={get:function(k){return tx('readonly',function(s){return s.get(k)});},set:function(k,v){return tx('readwrite',function(s){return s.put(v,k)});},del:function(k){return tx('readwrite',function(s){return s.delete(k)});}};
};
__r(0);
})();
