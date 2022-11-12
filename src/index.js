class Uploader {
  constructor(signatureApi, maxSideWidth) {
    this.countTask = 0; //所有的任务数
    this.concurrencyCount = 1; //并发数
    this.waitingQueue = []; // 待上传队列
    this.uploadingQueue = []; // 上传中队列
    this.errorQueue = []; // 上传失败队列
    this.uploadedQueue = []; // 上传成功队列
    this.choosing = false; // 是否正在选择图片
    this.uploading = false; // 是否正在上传
    this.isCheckingQueue = false;
    this.maxSideWidth = maxSideWidth; // 限制图片最长边大小，若有这个选项，则压缩图片。如 1080
    this.taskId = 0;
    this.checkQueueList = null;

    this.debug = false;

    /* 签名接口与数据 */
    this.signatureApi = signatureApi; // ()=> promise , resolve(signatureInfo)
    this.signatureInfo = null;
    // ex.
    // {
    //   "expire": "1666689212",
    //   "policy": "xxx",
    //   "signature": "xxx",
    //   "accessid": "xxx",
    //   "host": "http://xxx.oss-cn-shenzhen.aliyuncs.com",
    //   "callback": "eyJjYWxsYmFja1VybCI6Imh0dHBzOi8vNTE3NTBtNW8yNy56aWNwLmZ1bi9vc3NfdXBsb2FkX2NhbGxiYWNrIiwiY2FsbGJhY2tCb2R5IjoiZmlsZW5hbWU9JHtvYmplY3R9JnNpemU9JHtzaXplfSZtaW1lVHlwZT0ke21pbWVUeXBlfSZoZWlnaHQ9JHtpbWFnZUluZm8uaGVpZ2h0fSZ3aWR0aD0ke2ltYWdlSW5mby53aWR0aH0iLCJjYWxsYmFja0JvZHlUeXBlIjoiYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkIn0=",
    //   "dir": "upload/"
    // }

    /* 回调 */
    this.onComputedId = null; // 单个文件初始化成功事件
    this.onComputedMd5 = null; // 单个文件计算 md5
    this.onUploading = null; // 单个文件正在上传
    this.onSuccess = null; // 单个文件成功事件
    this.onError = null; // 单个文件失败事件
    this.onAllFinish = null; // 全部上传已执行事件（忽略失败任务）
    this.onAllSuccess = null; // 全部上传成功事件
    this.onProgress = null; // 进度事件
    this.eventType = null; // 上传的oss目录
  }

  // 【 选择文件 】
  chooseFile({
    count,
    sourceType,
    mediaType,
    sizeType,
  }, callbacks) {
    this.choosing = true;
    wx.chooseMedia({
      count: count || 1,
      mediaType: mediaType || ["image", "video"],
      sourceType: sourceType || ["album", "camera"],
      camera: "back",
      sizeType: sizeType || ['original', 'compressed'],
      success: (res) => {
        this.uploadFiles(
          Object.assign({
              files: res.tempFiles,
            },
            callbacks
          )
        );
      },
      complete: () => {
        this.choosing = false;
      },
    });
  }

  // 【 上传文件 】
  uploadFiles({
    files,
    onComputedId,
    onComputedMd5,
    onUploading,
    onProgress,
    onSuccess,
    onAllFinish,
    onAllSuccess,
    onError,
  }) {
    const _this = this;
    _this.countTask += files.length;
    _this.uploading = true; // 正在上传
    _this.loadedBuffer = 0;
    _this.bufferSpeed = 0;
    _this.onComputedId = onComputedId;
    _this.onComputedMd5 = onComputedMd5;
    _this.onSuccess = onSuccess;
    _this.onError = onError;
    _this.onAllFinish = onAllFinish;
    _this.onAllSuccess = onAllSuccess;
    _this.onProgress = onProgress;
    _this.onUploading = onUploading;

    let i = 0;

    // 检查上传队列，开始上传
    _this.checkQueueList = async function () {
      if (
        _this.waitingQueue.length !== 0 &&
        _this.uploadingQueue.length < _this.concurrencyCount
      ) {
        _this.isCheckingQueue = true;
        const uploadTask = _this.waitingQueue.shift();

        // 压缩图片
        if (_this.maxSideWidth) {
          const resultFilePath = await Uploader.compressImage(uploadTask.filePath, _this.maxSideWidth);
          uploadTask.filePath = resultFilePath
        }
  
        _this.uploadingQueue.push(uploadTask);
        onUploadUploading(uploadTask);
        getSignature()
          .then(() => uploadToOss(uploadTask))
          .catch(() => {
            // 从上传中队列移出
            Uploader.removeOutOf(_this.uploadingQueue, uploadTask);
            onUploadError(uploadTask);
            // 检测上传队列
            _this.checkQueueList();
          });
      } else if (
        _this.waitingQueue.length === 0 &&
        _this.uploadingQueue.length === 0
      ) {
        _this.isCheckingQueue = false;
        _this.uploading = false;

        // 全部完成，（此时忽略上传失败，默认为全部已完成）
        onUploadAllFinish();

        if (_this.errorQueue.length === 0) {
          // 此时没有失败任务则全部成功
          onUploadAllSuccess();
        }
      }
    };

    judge();

    // 枢纽1
    function judge() {
      if (i < files.length) {
        initQueue();
      } else {
        // 检查上传列表
        _this.checkQueueList();
      }
    }

    // 装配上传队列
    function initQueue() {
      const file = files[i];
      /* 
      ex.
        {
          "tempFilePath": "http://tmp/E8KVV2yIRil67469c12cd6bc64963ac2dd3ac842fc16.JPG",
          "size": 195980,
          "fileType": "image"
        }
      */
      const filePath = file.tempFilePath;

      /* 任务初始化 */
      const uploadTask = {
        id: _this.taskId,
        url: filePath,
        suffix: Uploader.getFileSuffix(filePath),
        status: "wait",
        filePath,
      };
      _this.waitingQueue.push(uploadTask);
      onUploadComputedId(uploadTask);
      _this.taskId++;

      /* 计算md5 */
      uploadTask.md5 = MD5(filePath);
      onUploadComputedMd5(uploadTask);

      i++;
      judge();
    }

    //上传前获取签名 update标记说明需要更新
    function getSignature(forceUpdate) {
      return new Promise((resolve, reject) => {
        if (!_this.signatureInfo || forceUpdate) {
          _this
            .signatureApi()
            .then((info) => {
              _this.signatureInfo = info;
              resolve();
            })
            .catch(() => {
              reject();
            });
        } else {
          resolve();
        }
      });
    }

    // 上传到oss
    function uploadToOss(uploadTask) {
      wx.uploadFile({
        url: !_this.debug ?
          _this.signatureInfo.host : _this.signatureInfo.host + "123",
        filePath: uploadTask.filePath,
        name: "file",
        formData: {
          name: `${uploadTask.md5}.${uploadTask.suffix}`,
          key: `${_this.signatureInfo.dir}${uploadTask.md5}.${uploadTask.suffix}`,
          policy: _this.signatureInfo.policy,
          OSSAccessKeyId: _this.signatureInfo.accessid,
          success_action_status: "200",
          signature: _this.signatureInfo.signature,
          callback: _this.signatureInfo.callback,
        },
        success: (res) => {
          if (res.statusCode == 200 && res.data) {
            const response = JSON.parse(res.data);
            const data = response.data;

            if (data.Status === "Ok") {
              // 上传成功
              // 从上传中队列移出
              Uploader.removeOutOf(_this.uploadingQueue, uploadTask);
              // 加入上传成功队列
              uploadTask.uploadedUrl = data.url;
              _this.uploadedQueue.push(uploadTask);
              onUploadSuccess(uploadTask);
              // 继续队列
              _this.checkQueueList();
            } else {
              // 上传失败
              cbFail();
            }
          } else {
            // 上传失败
            cbFail();
          }
        },
        fail: function ({
          errMsg
        }) {
          // 上传失败
          cbFail();
        },
      });

      function cbFail() {
        // 从上传中队列移出
        Uploader.removeOutOf(_this.uploadingQueue, uploadTask);
        onUploadError(uploadTask);
        // 检测上传队列
        _this.checkQueueList();
      }
    }

    // 初始化回调处理器
    function onUploadComputedId(uploadTask) {
      onUploadProgress(uploadTask, "inited");
      if (typeof _this.onComputedId == "function") {
        _this.onComputedId(Object.assign({}, uploadTask));
      }
    }

    // md5回调处理器
    function onUploadComputedMd5(uploadTask) {
      onUploadProgress(uploadTask, "md5");
      if (typeof _this.onComputedMd5 == "function") {
        _this.onComputedMd5(Object.assign({}, uploadTask));
      }
    }

    // 上传中回调处理器
    function onUploadUploading(uploadTask) {
      onUploadProgress(uploadTask, "uploading");
      if (typeof _this.onUploading == "function") {
        _this.onUploading(Object.assign({}, uploadTask));
      }
    }

    // 进度回调处理器
    function onUploadProgress(uploadTask, status, progress = null) {
      uploadTask.status = status;
      uploadTask.progress = progress;
      if (typeof _this.onProgress == "function") {
        _this.onProgress(Object.assign({}, uploadTask));
      }
    }

    // 成功回调处理器
    function onUploadSuccess(uploadTask) {
      onUploadProgress(uploadTask, "success");

      if (typeof _this.onSuccess == "function") {
        // 还剩余多少个未上传
        const existCount =
          _this.waitingQueue.length +
          _this.uploadingQueue.length +
          _this.errorQueue.length;

        _this.onSuccess(Object.assign({}, uploadTask), existCount);
      }
    }

    // 全部完成回调处理器
    function onUploadAllFinish() {
      if (typeof _this.onAllFinish == "function") {
        _this.onAllFinish();
      }
    }

    // 全部上传成功回调处理器
    function onUploadAllSuccess() {
      if (typeof _this.onAllSuccess == "function") {
        _this.onAllSuccess();
      }
    }

    // 失败回调处理器
    function onUploadError(uploadTask) {
      onUploadProgress(uploadTask, "fail");
      _this.errorQueue.push(uploadTask);

      if (typeof _this.onError == "function") {
        _this.onError(Object.assign({}, uploadTask));
      }
    }
  }

  // 【 打开或关闭调试, 该调试开关能使上传任务失败 】
  toggleDebug() {
    this.debug = !this.debug;
  }

  // 【 重试所有失败任务 】
  retryErrorQueue() {
    while (this.errorQueue.length) {
      const uploadTask = this.errorQueue.shift();
      const {
        id,
        url,
        suffix,
        filePath,
        md5
      } = uploadTask;
      const _uploadTask = {
        id,
        url,
        suffix,
        filePath,
        md5,
        status: "md5",
      };

      this.waitingQueue.push(_uploadTask);
    }
    if (!this.isCheckingQueue) {
      this.checkQueueList && this.checkQueueList();
    }
  }

  // 【 重试单个失败任务 】
  retryErrorTaskById(taskId) {
    const uploadTaskIndex = this.errorQueue.findIndex(
      (item) => item.id === Number(taskId)
    );
    if (uploadTaskIndex > -1) {
      const uploadTask = this.errorQueue.splice(uploadTaskIndex, 1)[0];
      const {
        id,
        url,
        suffix,
        filePath,
        md5
      } = uploadTask;
      const _uploadTask = {
        id,
        url,
        suffix,
        filePath,
        md5,
        status: "md5",
      };

      this.waitingQueue.push(_uploadTask);

      if (!this.isCheckingQueue) {
        this.checkQueueList && this.checkQueueList();
      }
    }
  }

  // 【 从任何队列移除某一任务 】
  delTaskById(taskId) {
    const task = {
      id: Number(taskId),
    };
    Uploader.removeOutOf(this.waitingQueue, task);
    Uploader.removeOutOf(this.uploadingQueue, task);
    Uploader.removeOutOf(this.uploadedQueue, task);
    Uploader.removeOutOf(this.errorQueue, task);
    this.countTask -= 1;
  }

  // 从某个队列移出某项(id)
  static removeOutOf(list, uploadTask) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      if (id == uploadTask.id) {
        list.splice(i, 1);
      }
    }
  }

  // 获取文件后缀
  static getFileSuffix(filename) {
    const pos = filename.lastIndexOf(".");
    let suffix = "";
    if (pos != -1) {
      suffix = filename.substring(pos + 1);
    }
    return suffix;
  }

  // 压缩图片
  static compressImage(src, maxSideWidth) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src,
        success: ({
          width,
          height
        }) => {
          wx.compressImage({
            src,
            [width > height ? 'compressedWidth' : 'compressHeight']: maxSideWidth,
            success: ({tempFilePath}) => {
              if (!tempFilePath) {
                reject()
              } else {
                let correctPath = tempFilePath;
                let _case = -1;
                (tempFilePath.indexOf("undefined") > -1) && (_case = 1);
                (tempFilePath.indexOf('.') === -1) && (_case = 2);
                (tempFilePath.lastIndexOf('.') === tempFilePath.length - 1) && (_case = 3);

                // 兼容压缩后无文件名后缀
                if (_case > 0) {
                  const fileName = src.split('/').pop();
                  const newPath = `${wx.env.USER_DATA_PATH}/${fileName}`
                  wx.getFileSystemManager().renameSync(tempFilePath, newPath) // 重命名图片
                  correctPath = newPath;
                }

                resolve(correctPath)
              }
            },
            fail: () => {
              reject();
            }
          })
        },
        fail: () => {
          reject();
        }
      })
    })
  }
}

var MD5 = (function (r) {
  function n(o) {
    if (t[o]) return t[o].exports;
    var e = (t[o] = {
      i: o,
      l: !1,
      exports: {},
    });
    return r[o].call(e.exports, e, e.exports, n), (e.l = !0), e.exports;
  }
  var t = {};
  return (
    (n.m = r),
    (n.c = t),
    (n.i = function (r) {
      return r;
    }),
    (n.d = function (r, t, o) {
      n.o(r, t) ||
        Object.defineProperty(r, t, {
          configurable: !1,
          enumerable: !0,
          get: o,
        });
    }),
    (n.n = function (r) {
      var t =
        r && r.__esModule ?
        function () {
          return r.default;
        } :
        function () {
          return r;
        };
      return n.d(t, "a", t), t;
    }),
    (n.o = function (r, n) {
      return Object.prototype.hasOwnProperty.call(r, n);
    }),
    (n.p = ""),
    n((n.s = 4))
  );
})([
  function (r, n) {
    var t = {
      utf8: {
        stringToBytes: function (r) {
          return t.bin.stringToBytes(unescape(encodeURIComponent(r)));
        },
        bytesToString: function (r) {
          return decodeURIComponent(escape(t.bin.bytesToString(r)));
        },
      },
      bin: {
        stringToBytes: function (r) {
          for (var n = [], t = 0; t < r.length; t++)
            n.push(255 & r.charCodeAt(t));
          return n;
        },
        bytesToString: function (r) {
          for (var n = [], t = 0; t < r.length; t++)
            n.push(String.fromCharCode(r[t]));
          return n.join("");
        },
      },
    };
    r.exports = t;
  },
  function (r, n, t) {
    !(function () {
      var n = t(2),
        o = t(0).utf8,
        e = t(3),
        u = t(0).bin,
        i = function (r, t) {
          r.constructor == String ?
            (r =
              t && "binary" === t.encoding ?
              u.stringToBytes(r) :
              o.stringToBytes(r)) :
            e(r) ?
            (r = Array.prototype.slice.call(r, 0)) :
            Array.isArray(r) || (r = r.toString());
          for (
            var f = n.bytesToWords(r),
              s = 8 * r.length,
              c = 1732584193,
              a = -271733879,
              l = -1732584194,
              g = 271733878,
              h = 0; h < f.length; h++
          )
            f[h] =
            (16711935 & ((f[h] << 8) | (f[h] >>> 24))) |
            (4278255360 & ((f[h] << 24) | (f[h] >>> 8)));
          (f[s >>> 5] |= 128 << s % 32), (f[14 + (((s + 64) >>> 9) << 4)] = s);
          for (
            var p = i._ff, y = i._gg, v = i._hh, d = i._ii, h = 0; h < f.length; h += 16
          ) {
            var b = c,
              T = a,
              x = l,
              B = g;
            (c = p(c, a, l, g, f[h + 0], 7, -680876936)),
            (g = p(g, c, a, l, f[h + 1], 12, -389564586)),
            (l = p(l, g, c, a, f[h + 2], 17, 606105819)),
            (a = p(a, l, g, c, f[h + 3], 22, -1044525330)),
            (c = p(c, a, l, g, f[h + 4], 7, -176418897)),
            (g = p(g, c, a, l, f[h + 5], 12, 1200080426)),
            (l = p(l, g, c, a, f[h + 6], 17, -1473231341)),
            (a = p(a, l, g, c, f[h + 7], 22, -45705983)),
            (c = p(c, a, l, g, f[h + 8], 7, 1770035416)),
            (g = p(g, c, a, l, f[h + 9], 12, -1958414417)),
            (l = p(l, g, c, a, f[h + 10], 17, -42063)),
            (a = p(a, l, g, c, f[h + 11], 22, -1990404162)),
            (c = p(c, a, l, g, f[h + 12], 7, 1804603682)),
            (g = p(g, c, a, l, f[h + 13], 12, -40341101)),
            (l = p(l, g, c, a, f[h + 14], 17, -1502002290)),
            (a = p(a, l, g, c, f[h + 15], 22, 1236535329)),
            (c = y(c, a, l, g, f[h + 1], 5, -165796510)),
            (g = y(g, c, a, l, f[h + 6], 9, -1069501632)),
            (l = y(l, g, c, a, f[h + 11], 14, 643717713)),
            (a = y(a, l, g, c, f[h + 0], 20, -373897302)),
            (c = y(c, a, l, g, f[h + 5], 5, -701558691)),
            (g = y(g, c, a, l, f[h + 10], 9, 38016083)),
            (l = y(l, g, c, a, f[h + 15], 14, -660478335)),
            (a = y(a, l, g, c, f[h + 4], 20, -405537848)),
            (c = y(c, a, l, g, f[h + 9], 5, 568446438)),
            (g = y(g, c, a, l, f[h + 14], 9, -1019803690)),
            (l = y(l, g, c, a, f[h + 3], 14, -187363961)),
            (a = y(a, l, g, c, f[h + 8], 20, 1163531501)),
            (c = y(c, a, l, g, f[h + 13], 5, -1444681467)),
            (g = y(g, c, a, l, f[h + 2], 9, -51403784)),
            (l = y(l, g, c, a, f[h + 7], 14, 1735328473)),
            (a = y(a, l, g, c, f[h + 12], 20, -1926607734)),
            (c = v(c, a, l, g, f[h + 5], 4, -378558)),
            (g = v(g, c, a, l, f[h + 8], 11, -2022574463)),
            (l = v(l, g, c, a, f[h + 11], 16, 1839030562)),
            (a = v(a, l, g, c, f[h + 14], 23, -35309556)),
            (c = v(c, a, l, g, f[h + 1], 4, -1530992060)),
            (g = v(g, c, a, l, f[h + 4], 11, 1272893353)),
            (l = v(l, g, c, a, f[h + 7], 16, -155497632)),
            (a = v(a, l, g, c, f[h + 10], 23, -1094730640)),
            (c = v(c, a, l, g, f[h + 13], 4, 681279174)),
            (g = v(g, c, a, l, f[h + 0], 11, -358537222)),
            (l = v(l, g, c, a, f[h + 3], 16, -722521979)),
            (a = v(a, l, g, c, f[h + 6], 23, 76029189)),
            (c = v(c, a, l, g, f[h + 9], 4, -640364487)),
            (g = v(g, c, a, l, f[h + 12], 11, -421815835)),
            (l = v(l, g, c, a, f[h + 15], 16, 530742520)),
            (a = v(a, l, g, c, f[h + 2], 23, -995338651)),
            (c = d(c, a, l, g, f[h + 0], 6, -198630844)),
            (g = d(g, c, a, l, f[h + 7], 10, 1126891415)),
            (l = d(l, g, c, a, f[h + 14], 15, -1416354905)),
            (a = d(a, l, g, c, f[h + 5], 21, -57434055)),
            (c = d(c, a, l, g, f[h + 12], 6, 1700485571)),
            (g = d(g, c, a, l, f[h + 3], 10, -1894986606)),
            (l = d(l, g, c, a, f[h + 10], 15, -1051523)),
            (a = d(a, l, g, c, f[h + 1], 21, -2054922799)),
            (c = d(c, a, l, g, f[h + 8], 6, 1873313359)),
            (g = d(g, c, a, l, f[h + 15], 10, -30611744)),
            (l = d(l, g, c, a, f[h + 6], 15, -1560198380)),
            (a = d(a, l, g, c, f[h + 13], 21, 1309151649)),
            (c = d(c, a, l, g, f[h + 4], 6, -145523070)),
            (g = d(g, c, a, l, f[h + 11], 10, -1120210379)),
            (l = d(l, g, c, a, f[h + 2], 15, 718787259)),
            (a = d(a, l, g, c, f[h + 9], 21, -343485551)),
            (c = (c + b) >>> 0),
            (a = (a + T) >>> 0),
            (l = (l + x) >>> 0),
            (g = (g + B) >>> 0);
          }
          return n.endian([c, a, l, g]);
        };
      (i._ff = function (r, n, t, o, e, u, i) {
        var f = r + ((n & t) | (~n & o)) + (e >>> 0) + i;
        return ((f << u) | (f >>> (32 - u))) + n;
      }),
      (i._gg = function (r, n, t, o, e, u, i) {
        var f = r + ((n & o) | (t & ~o)) + (e >>> 0) + i;
        return ((f << u) | (f >>> (32 - u))) + n;
      }),
      (i._hh = function (r, n, t, o, e, u, i) {
        var f = r + (n ^ t ^ o) + (e >>> 0) + i;
        return ((f << u) | (f >>> (32 - u))) + n;
      }),
      (i._ii = function (r, n, t, o, e, u, i) {
        var f = r + (t ^ (n | ~o)) + (e >>> 0) + i;
        return ((f << u) | (f >>> (32 - u))) + n;
      }),
      (i._blocksize = 16),
      (i._digestsize = 16),
      (r.exports = function (r, t) {
        if (void 0 === r || null === r)
          throw new Error("Illegal argument " + r);
        var o = n.wordsToBytes(i(r, t));
        return t && t.asBytes ?
          o :
          t && t.asString ?
          u.bytesToString(o) :
          n.bytesToHex(o);
      });
    })();
  },
  function (r, n) {
    !(function () {
      var n =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
        t = {
          rotl: function (r, n) {
            return (r << n) | (r >>> (32 - n));
          },
          rotr: function (r, n) {
            return (r << (32 - n)) | (r >>> n);
          },
          endian: function (r) {
            if (r.constructor == Number)
              return (16711935 & t.rotl(r, 8)) | (4278255360 & t.rotl(r, 24));
            for (var n = 0; n < r.length; n++) r[n] = t.endian(r[n]);
            return r;
          },
          randomBytes: function (r) {
            for (var n = []; r > 0; r--)
              n.push(Math.floor(256 * Math.random()));
            return n;
          },
          bytesToWords: function (r) {
            for (var n = [], t = 0, o = 0; t < r.length; t++, o += 8)
              n[o >>> 5] |= r[t] << (24 - (o % 32));
            return n;
          },
          wordsToBytes: function (r) {
            for (var n = [], t = 0; t < 32 * r.length; t += 8)
              n.push((r[t >>> 5] >>> (24 - (t % 32))) & 255);
            return n;
          },
          bytesToHex: function (r) {
            for (var n = [], t = 0; t < r.length; t++)
              n.push((r[t] >>> 4).toString(16)),
              n.push((15 & r[t]).toString(16));
            return n.join("");
          },
          hexToBytes: function (r) {
            for (var n = [], t = 0; t < r.length; t += 2)
              n.push(parseInt(r.substr(t, 2), 16));
            return n;
          },
          bytesToBase64: function (r) {
            for (var t = [], o = 0; o < r.length; o += 3)
              for (
                var e = (r[o] << 16) | (r[o + 1] << 8) | r[o + 2], u = 0; u < 4; u++
              )
                8 * o + 6 * u <= 8 * r.length ?
                t.push(n.charAt((e >>> (6 * (3 - u))) & 63)) :
                t.push("=");
            return t.join("");
          },
          base64ToBytes: function (r) {
            r = r.replace(/[^A-Z0-9+\/]/gi, "");
            for (var t = [], o = 0, e = 0; o < r.length; e = ++o % 4)
              0 != e &&
              t.push(
                ((n.indexOf(r.charAt(o - 1)) &
                    (Math.pow(2, -2 * e + 8) - 1)) <<
                  (2 * e)) |
                (n.indexOf(r.charAt(o)) >>> (6 - 2 * e))
              );
            return t;
          },
        };
      r.exports = t;
    })();
  },
  function (r, n) {
    function t(r) {
      return (
        !!r.constructor &&
        "function" == typeof r.constructor.isBuffer &&
        r.constructor.isBuffer(r)
      );
    }

    function o(r) {
      return (
        "function" == typeof r.readFloatLE &&
        "function" == typeof r.slice &&
        t(r.slice(0, 0))
      );
    }
    /*!
     * Determine if an object is a Buffer
     *
     * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
     * @license  MIT
     */
    r.exports = function (r) {
      return null != r && (t(r) || o(r) || !!r._isBuffer);
    };
  },
  function (r, n, t) {
    r.exports = t(1);
  },
]);


export default Uploader;