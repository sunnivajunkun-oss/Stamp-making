/* Browser & miniTool compatible saving adapter */
(function () {
  'use strict';
  function api() { return window.xhs && window.xhs.miniTool; }
  function detail(error) {
    if (!error) return '未知错误';
    return (error.errMsg || error.message || String(error)) + (error.errCode !== undefined ? '（错误码 ' + error.errCode + '）' : '');
  }
  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [null, 'image/png'])[1];
    var bstr = atob(parts[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  }
  async function prepare(data, size) {
    var tool = api();
    if (tool && typeof tool.saveImageToPhotosAlbum === 'function') {
      if (size > 100 * 1024 && typeof tool.writeTempFile === 'function') {
        var result = await tool.writeTempFile({ data: data });
        if (result && result.filePath) {
          return { filePath: result.filePath, route: '小红书临时文件', version: 'xhs', isBrowser: false };
        }
      }
      return { filePath: data, route: '小红书数据', version: 'xhs', isBrowser: false };
    }
    return { filePath: data, route: '浏览器直接下载', version: 'Web', isBrowser: true };
  }
  function save(prepared) {
    if (!prepared || !prepared.filePath) return Promise.reject(new Error('请先生成图片'));
    var tool = api();
    if (!prepared.isBrowser && tool && typeof tool.saveImageToPhotosAlbum === 'function') {
      return new Promise(function (resolve, reject) {
        tool.saveImageToPhotosAlbum({
          filePath: prepared.filePath,
          success: function (res) { resolve(res); },
          fail: function (err) { reject(err || new Error('保存未完成')); }
        });
      });
    }
    return new Promise(function (resolve, reject) {
      try {
        var blob = dataUrlToBlob(prepared.filePath);
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'stamp-' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        resolve({ ok: true });
      } catch (err) {
        reject(err);
      }
    });
  }
  window.StampAlbum = {
    prepare: prepare,
    save: save,
    detail: detail,
    available: function () { return true; }
  };
})();