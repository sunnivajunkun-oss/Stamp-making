/* Official miniTool API adapter. No network, private bridge or browser saving fallback. */
(function () {
  'use strict';
  function api() { return window.xhs && window.xhs.miniTool; }
  function detail(error) {
    if (!error) return '平台未提供错误详情';
    return (error.errMsg || error.message || String(error)) + (error.errCode !== undefined ? '（错误码 ' + error.errCode + '）' : '');
  }
  function timed(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('平台准备超时，请重新生成图片')); }, ms);
      Promise.resolve(promise).then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }
  function version(options) { return Math.floor(Number(options && options.miniToolEnv && options.miniToolEnv.buildVersion || 0) / 1000); }
  async function prepare(data, size) {
    var tool = api();
    if (!tool || typeof tool.saveImageToPhotosAlbum !== 'function') throw new Error('未检测到小红书保存能力，请在小红书小工具中打开，并更新客户端后重试');
    var v = version(window.xhs && window.xhs.launchOptions);
    if (!v && typeof tool.getLaunchOptions === 'function') {
      try { v = version(await timed(tool.getLaunchOptions(), 5000)); } catch (_) { /* Capability check remains authoritative when metadata is unavailable. */ }
    }
    if (v && v < 9420) throw new Error('保存图片需要小红书 9.42 或更新版本');
    if (size > 100 * 1024 && typeof tool.writeTempFile === 'function') {
      var result = await timed(tool.writeTempFile({ data: data }), 15000);
      if (!result || typeof result.filePath !== 'string' || !result.filePath) throw new Error('平台未返回有效的临时图片路径');
      return { filePath: result.filePath, route: '临时文件', version: v };
    }
    if (size > 1024 * 1024) throw new Error('当前环境缺少大图准备能力，请更新客户端，或降低导出倍率后重试');
    return { filePath: data, route: 'PNG 数据', version: v };
  }
  var busy = false;
  function save(prepared, onWaiting) {
    if (busy) return Promise.reject(new Error('上一次保存仍在等待平台返回，请勿重复提交'));
    var tool = api();
    if (!tool || typeof tool.saveImageToPhotosAlbum !== 'function') return Promise.reject(new Error('小红书保存能力不可用，请重新打开小工具'));
    if (!prepared || !prepared.filePath) return Promise.reject(new Error('请先生成图片'));
    busy = true;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () { if (onWaiting) onWaiting(); }, 20000);
      function finish(error, result) {
        if (settled) return;
        settled = true; busy = false; clearTimeout(timer);
        if (error) reject(error);
        else if (result && result.errMsg === 'saveImageToPhotosAlbum:ok') resolve(result);
        else reject(new Error('平台未确认保存成功，请检查相册后再决定是否重试'));
      }
      try {
        // Call immediately in the click handler; callbacks preserve the native user action.
        tool.saveImageToPhotosAlbum({ filePath: prepared.filePath,
          success: function (result) { finish(null, result); },
          fail: function (error) { finish(error || new Error('保存未完成')); }
        });
      } catch (error) { finish(error); }
    });
  }
  window.StampAlbum = { prepare: prepare, save: save, detail: detail, available: function () { var t=api(); return !!(t && typeof t.saveImageToPhotosAlbum === 'function'); } };
})();
