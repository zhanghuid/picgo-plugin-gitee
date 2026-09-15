const uploadedName = "gitee";
const domain = "https://gitee.com";
// 独立域名：直接命中，避免走默认域名的 302 重定向。
// 参考：https://help.gitee.com/repository/file-operate/raw#%E7%8B%AC%E7%AB%8B%E5%9F%9F%E5%90%8D
const previewDomain = "https://raw.giteeusercontent.com";
const apiPath = "/api/v5/repos";
const urlParser = require("url");
const defaultMsg = "picgo commit";

module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register(uploadedName, {
      handle,
      name: "Gitee图床",
      config: config,
    });

    ctx.on("remove", onRemove);
  };

  // GUI 菜单项：手动触发"从 Gitee 拉取远程文件到相册"
  const guiMenu = (ctx) => {
    return [
      {
        label: "同步 Gitee 远程文件到相册",
        async handle(ctx, guiApi) {
          // picgo GUI 有时会把 async handle 里的异常静默吞掉。
          // 手动加 try/catch 确保任何错误都能反馈到 UI 和日志。
          const started = Date.now();
          log("info", "[同步]按钮被点击");
          log("info", `[同步]ctx 类型: ${typeof ctx}, guiApi 类型: ${typeof guiApi}`);
          log(
            "info",
            `[同步]guiApi.galleryDB: ${guiApi && !!guiApi.galleryDB}, guiApi.showNotification: ${guiApi && !!guiApi.showNotification}`
          );
          try {
            await syncRemoteToGallery(ctx, guiApi);
            log("success", `[同步]完成，耗时 ${Date.now() - started}ms`);
          } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            const stack = err && err.stack ? err.stack : "";
            log("error", "[同步]失败：" + msg);
            if (stack) log("error", stack);
            // 通道 1：ctx.emit('notification') — PicGo 主窗口消息中心（最可靠）
            try {
              if (ctx && ctx.emit) {
                ctx.emit("notification", {
                  title: "Gitee 同步失败",
                  body: msg,
                });
              }
            } catch (e) {
              log("error", "[同步]ctx.emit 失败：" + e.message);
            }
            // 通道 2：showMessageBox — 系统弹窗，最醒目
            if (guiApi && guiApi.showMessageBox) {
              try {
                guiApi.showMessageBox({
                  type: "error",
                  title: "Gitee 同步失败",
                  message: msg,
                  detail: stack ? stack.split("\n").slice(0, 3).join("\n") : "",
                });
              } catch (e) {
                log("error", "[同步]showMessageBox 失败：" + e.message);
              }
            }
            // 通道 3：showNotification — 系统通知（依赖 OS 权限）
            if (guiApi && guiApi.showNotification) {
              try {
                guiApi.showNotification({
                  title: "Gitee 同步失败",
                  body: msg,
                });
              } catch (e) {
                log("error", "[同步]showNotification 失败：" + e.message);
              }
            }
          }
        },
      },
    ];
  };

  // 统一的日志输出，兼容 picgo-core (ctx.log.info) 和 picgo GUI (ctx.log 可能行为不同)
  // 同时打 console 兜底，确保 Electron 主进程也能看到
  const log = function (level, msg) {
    try {
      // picgo 的 ctx.log 支持 info / warn / success / error
      const fn = ctx.log && (ctx.log[level] || ctx.log.info);
      if (fn) fn.call(ctx.log, msg);
    } catch (e) {
      // 静吞
    }
    // 兜底：直接打到 stdout，这样无论 picgo GUI 把日志写到哪，这里都至少有一条记录
    // （用户终端如果通过 npm 链接加载插件，能看到；GUI 主进程 console 也能看到）
    if (typeof console !== "undefined") {
      try {
        console.log("[picgo-plugin-gitee]", level.toUpperCase(), msg);
      } catch (e) {
        // 静吞
      }
    }
  };

  // 相册里只保留图片文件，避免把 README/配置文件等也拉进来
  const IMAGE_EXTS = new Set([
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg",
    "tif", "tiff", "ico", "avif", "heic",
  ]);

  // 递归列出 Gitee 仓库所有图片文件（含子目录）。
  // 返回 [{ fileName, imgUrl, sha, size }]
  const listAllRemoteFiles = async function (userConfig) {
    const headers = getHeaders();
    const listUrl =
      userConfig.baseUrl + "/contents" + formatConfigPath(userConfig);
    const out = [];
    await walkContents(listUrl, userConfig, headers, out);
    return out
      .filter((it) => {
        const ext = (it.name || "").split(".").pop().toLowerCase();
        return IMAGE_EXTS.has(ext);
      })
      .map((it) => ({
        fileName: it.path,
        imgUrl: userConfig.previewUrl + "/" + it.path,
        sha: it.sha,
        size: it.size,
      }));
  };

  const walkContents = async function (url, userConfig, headers, out) {
    const fullUrl = url + "?access_token=" + userConfig.token;
    let res;
    try {
      res = await ctx.Request.request({
        method: "GET",
        url: fullUrl,
        headers: headers,
      });
    } catch (err) {
      throw new Error("获取 Gitee 目录失败：" + err.message);
    }
    // 兼容 picgo-core（字符串）和 picgo GUI（对象）
    const items = typeof res === "string" ? JSON.parse(res) : res;
    if (!Array.isArray(items)) {
      // 单文件（理论上 listAllRemoteFiles 不会传单文件路径，兜底）
      if (items && items.type === "file") {
        out.push(items);
      }
      return;
    }
    for (const item of items) {
      if (item.type === "file") {
        out.push(item);
      } else if (item.type === "dir") {
        // 递归子目录
        await walkContents(url + "/" + item.path, userConfig, headers, out);
      }
    }
  };

  // 把 Gitee 远程文件写入 PicGo GUI 相册。
  // 关键点：每条记录带 type="gitee"，这样从相册删除时会触发 onRemove 真正删除 gitee 上的文件。
  // 异常统一向上抛出，由 guiMenu.handle 里的 catch 统一弹窗。
  const syncRemoteToGallery = async function (ctx, guiApi) {
    if (!guiApi || !guiApi.galleryDB) {
      throw new Error("当前不在 PicGo GUI 环境（galleryDB 不可用）");
    }
    log("info", "[同步]开始检查配置");
    let userConfig;
    try {
      userConfig = getUserConfig();
    } catch (err) {
      throw new Error("请先在插件设置中填写 owner / repo / token");
    }
    if (!userConfig.owner || !userConfig.repo || !userConfig.token) {
      throw new Error("请先在插件设置中填写 owner / repo / token");
    }
    log(
      "info",
      `[同步]配置 OK: owner=${userConfig.owner} repo=${userConfig.repo} path=${userConfig.path || "(root)"}`
    );

    notify("success", ctx, guiApi, "正在同步", "正在从 Gitee 拉取远程文件...");

    log("info", "[同步]开始递归拉取 Gitee 文件列表");
    const remoteFiles = await listAllRemoteFiles(userConfig);
    log("info", `[同步]仓库共 ${remoteFiles.length} 个图片文件`);

    if (remoteFiles.length === 0) {
      log("warn", "[同步]仓库里没有任何图片文件");
      notify(
        "success",
        ctx,
        guiApi,
        "Gitee 同步完成",
        "仓库里没有任何图片文件"
      );
      return;
    }

    log("info", "[同步]读取本地相册");
    // galleryDB.get() 返回 { total, data }（picgo/store 格式），
    // 也可能直接返回数组（早期版本兼容）。两种都处理。
    const getResult = await guiApi.galleryDB.get();
    const existing = Array.isArray(getResult)
      ? getResult
      : getResult && Array.isArray(getResult.data)
      ? getResult.data
      : [];
    log("info", `[同步]本地相册已有 ${existing.length} 条`);
    const existingUrls = new Set(existing.map((x) => x.imgUrl));
    const newItems = remoteFiles
      .filter((f) => !existingUrls.has(f.imgUrl))
      .map((f) => ({
        fileName: f.fileName,
        imgUrl: f.imgUrl,
        type: uploadedName,
        sha: f.sha,
        extname: f.fileName.split(".").pop(),
      }));
    log(
      "info",
      `[同步]需要新增 ${newItems.length} 条（已存在 ${remoteFiles.length - newItems.length} 条）`
    );

    if (newItems.length === 0) {
      notify(
        "success",
        ctx,
        guiApi,
        "Gitee 同步完成",
        "没有新增文件，相册已是最新"
      );
      return;
    }

    log("info", "[同步]写入相册 insertMany");
    await guiApi.galleryDB.insertMany(newItems);
    log(
      "success",
      `[同步]完成：共 ${remoteFiles.length} 个，新增 ${newItems.length} 个`
    );
    notify(
      "success",
      ctx,
      guiApi,
      "Gitee 同步完成",
      `新增 ${newItems.length} 个文件到相册（共发现 ${remoteFiles.length} 个）`
    );
  };

  // 多通道通知：根据场景选用合适的通道。
  // picgo 文档说明：ctx.emit('notification') 是给**失败**提示专用的通道；
  // 成功时 picgo 主进程已经处理（gui 弹窗/消息中心），插件无需重复 emit。
  // 所以 notify 函数有 success / fail 两种模式。
  const notify = function (mode, ctx, guiApi, title, body) {
    log(mode === "fail" ? "error" : "success", `[notify] ${title}: ${body}`);

    if (mode === "fail") {
      // 失败：ctx.emit（picgo 主窗口消息中心）+ showMessageBox 弹窗（最醒目）+ showNotification
      try {
        if (ctx && ctx.emit) {
          ctx.emit("notification", { title, body });
        }
      } catch (e) {
        log("error", "[notify] ctx.emit 失败：" + e.message);
      }
      try {
        if (guiApi && guiApi.showMessageBox) {
          guiApi.showMessageBox({
            type: "error",
            title: title,
            message: body,
          });
        }
      } catch (e) {
        log("error", "[notify] showMessageBox 失败：" + e.message);
      }
    }

    // 成功和失败都触发系统通知（依赖 OS 权限）
    try {
      if (guiApi && guiApi.showNotification) {
        log("11111", guiApi.showNotification({ title, body }));
      }
    } catch (e) {
      log("error", "[notify] showNotification 失败：" + e.message);
    }
  };

  const getHeaders = function () {
    return {
      "Content-Type": "application/json;charset=UTF-8",
    };
  };

  const getUserConfig = function () {
    let userConfig = ctx.getConfig("picBed.gitee");

    if (!userConfig) {
      throw new Error("Can't find uploader config");
    }

    userConfig["baseUrl"] =
      domain + apiPath + "/" + userConfig.owner + "/" + userConfig.repo;
    userConfig["previewUrl"] =
      (userConfig.customUrl || previewDomain) +
      "/" +
      userConfig.owner +
      "/" +
      userConfig.repo +
      "/raw/master" +
      formatConfigPath(userConfig);

    userConfig["message"] = userConfig.message || defaultMsg;

    return userConfig;
  };

  // uploader
  const handle = async function (ctx) {
    let userConfig = getUserConfig();

    const realUrl =
      userConfig.baseUrl + "/contents" + formatConfigPath(userConfig);

    let imgList = ctx.output;
    let successCount = 0;
    let failCount = 0;
    const fails = [];

    for (let i in imgList) {
      let image = imgList[i].buffer;
      if (!image && imgList[i].base64Image) {
        image = Buffer.from(imgList[i].base64Image, "base64");
      }

      let perRealUrl = realUrl + "/" + imgList[i].fileName;
      const postConfig = postOptions(perRealUrl, image);

      try {
        await ctx.Request.request(postConfig);
        imgList[i]["imgUrl"] =
          userConfig.previewUrl + "/" + imgList[i].fileName;
        successCount += 1;
        ctx.log.info(
          "[上传操作]成功：" + imgList[i].fileName + " -> " + imgList[i].imgUrl
        );
      } catch (err) {
        // duplicate file, so continue
        if (checkIsDuplicateFile(err.message)) {
          ctx.log.info("[上传操作]文件已存在：" + imgList[i].fileName);
          ctx.emit("notification", {
            title: "上传失败",
            body: `${imgList[i].fileName} 文件已经存在了`,
          });
          failCount += 1;
          continue;
        }
        failCount += 1;
        fails.push(`${imgList[i].fileName}: ${err.message}`);
        ctx.log.info("[上传操作]异常：" + err.message);
        ctx.emit("notification", {
          title: "上传失败",
          body: `${imgList[i].fileName} ${err.message}`,
        });
      }

      delete imgList[i].base64Image;
      delete imgList[i].buffer;
    }

    // 上传成功：让 picgo 主进程自己处理（它会弹"上传成功"提示），
    // 不重复 emit('notification')。这里只写日志 + 显示消息中心（如果失败）。
    if (fails.length > 0) {
      ctx.log.info("[上传操作]失败明细：" + JSON.stringify(fails));
    }

    return ctx;
  };

  const checkIsDuplicateFile = (message) => {
    return (
      message.indexOf("A file with this name already exists") != -1 ||
      message.indexOf("文件已经存在") != -1
    );
  };

  const postOptions = (url, image) => {
    let config = getUserConfig();
    let headers = getHeaders();
    let formData = {
      access_token: config.token,
      content: image.toString("base64"),
      message: config.message || defaultMsg,
    };
    const opts = {
      method: "POST",
      url: encodeURI(url),
      headers: headers,
      formData: formData,
    };
    return opts;
  };

  // trigger delete file
  // trigger delete file
  // 从 PicGo GUI 2.3.0 起，remove 事件的第二个参数是 guiApi（Electron 专属）
  const onRemove = async function (files, guiApi) {
    const rms = files.filter((each) => each.type === uploadedName);
    if (rms.length === 0) {
      return;
    }

    ctx.log.info("删除个数:" + rms.length);
    let headers = getHeaders();
    let config = getUserConfig();
    const fails = [];
    const successNames = [];

    for (let i = 0; i < rms.length; i++) {
      const each = rms[i];
      let filepath = getFilePath(each.imgUrl);
      let sha;
      try {
        sha = await getSha(filepath);
      } catch (err) {
        ctx.log.info(
          "[删除操作]获取 sha 失败，跳过：" + each.imgUrl + " " + err.message
        );
        fails.push(`${each.fileName || each.imgUrl}: 获取 sha 失败`);
        notify(
          "fail",
          ctx,
          guiApi,
          "删除失败",
          `${each.fileName || each.imgUrl} 获取 sha 失败`
        );
        continue;
      }

      if (!sha) {
        ctx.log.info("[删除操作]sha 为空，文件可能已被删除：" + each.imgUrl);
        fails.push(`${each.fileName || each.imgUrl}: 文件不存在`);
        continue;
      }

      const url =
        `${filepath}` +
        `?access_token=${config.token}` +
        `&message=${encodeURIComponent(config.message || defaultMsg)}` +
        `&sha=${sha}`;
      ctx.log.info("[删除操作]当前删除地址：" + url);
      const opts = {
        method: "DELETE",
        url: url,
        headers: headers,
      };
      try {
        const response = await ctx.Request.request(opts);
        // 兼容 string / object 两种响应形态，避免日志打 "[object Object]"
        ctx.log.info(
          "[删除操作]响应：" +
            (typeof response === "string" ? response : JSON.stringify(response))
        );
        successNames.push(each.fileName || each.imgUrl);
      } catch (err) {
        ctx.log.info(
          "[删除操作]失败：" +
            (each.fileName || each.imgUrl) +
            " " +
            err.message
        );
        fails.push(`${each.fileName || each.imgUrl}: ${err.message}`);
        notify(
          "fail",
          ctx,
          guiApi,
          "删除失败",
          `${each.fileName || each.imgUrl} ${err.message}`
        );
      }
    }

    // 删除成功：用 guiApi.showNotification 通知（picgo 不自动处理此通知）
    if (successNames.length > 0) {
      try {
        if (guiApi && guiApi.showNotification) {
          guiApi.showNotification({
            title: "删除完成",
            body: `成功同步删除 ${successNames.length} 个`,
          });
        }
      } catch (e) {
        log("error", "[删除操作]showNotification 失败：" + e.message);
      }
    }
    if (fails.length > 0) {
      ctx.log.info("[删除操作]失败明细：" + JSON.stringify(fails));
    }
  };

  // 把预览 URL 转成删除用的 API URL。
  // previewUrl 可能是默认域名、独立域名（raw.giteeusercontent.com）或用户自定义 customUrl，
  // 但 Gitee API 始终在 gitee.com，所以这里统一映射到 gitee.com/api/v5/repos/...。
  const getFilePath = function (url) {
    let parsed = urlParser.parse(url);
    // 去掉 raw/master，保留 owner/repo/path
    let urlStr = url.replace("raw/master", "contents");
    // 把 host 替换为 gitee.com，并插入 /api/v5/repos
    return urlStr.replace(
      `${parsed.protocol}//${parsed.host}`,
      `${parsed.protocol}//gitee.com${apiPath}`
    );
  };

  const getSha = async function (filepath) {
    let config = getUserConfig();
    let headers = getHeaders();
    let url = `${filepath}` + `?access_token=${config.token}`;

    const opts = {
      method: "GET",
      url: url,
      headers: headers,
    };

    let res = await ctx.Request.request(opts);
    // 兼容 picgo-core（返回 JSON 字符串）和 picgo GUI（直接返回 parsed object）
    let tmp = typeof res === "string" ? JSON.parse(res) : res;

    return tmp && tmp.sha;
  };

  const formatConfigPath = function (userConfig) {
    return userConfig.path ? "/" + userConfig.path : "";
  };

  const config = (ctx) => {
    let userConfig = ctx.getConfig("picBed.gitee");
    if (!userConfig) {
      userConfig = {};
    }
    return [
      {
        name: "owner",
        type: "input",
        default: userConfig.owner,
        required: true,
        message: "owner",
        alias: "仓库所属用户/组织",
        tips:
          "仓库 owner，例如仓库地址 https://gitee.com/zhanghuid/resources 中 owner 为 zhanghuid",
      },
      {
        name: "repo",
        type: "input",
        default: userConfig.repo,
        required: true,
        message: "repo",
        alias: "仓库名",
        tips: "仓库名，例如 resources",
      },
      {
        name: "path",
        type: "input",
        default: userConfig.path,
        required: false,
        message: "根目录可留空，例如 img/2026",
        alias: "存储路径",
        tips: "图片在仓库内的存储子目录，根目录可不填",
      },
      {
        name: "token",
        type: "password",
        default: userConfig.token,
        required: true,
        message: "Gitee 私人令牌",
        alias: "私人令牌 (token)",
        tips:
          "在 https://gitee.com/profile/personal_access_tokens 生成，需要 projects 和 pull_request 权限",
      },
      {
        name: "customUrl",
        type: "input",
        default: userConfig.customUrl,
        required: false,
        message: "可留空，默认使用 raw.giteeusercontent.com",
        alias: "自定义独立域名（可选）",
        tips:
          "如有自有独立域名（反代 raw.giteeusercontent.com 或 Gitee Page 绑定的域名），填这里；留空则默认使用 https://raw.giteeusercontent.com",
      },
      {
        name: "message",
        type: "input",
        default: userConfig.message,
        required: false,
        message: defaultMsg,
        alias: "提交信息 (commit message)",
        tips: "上传/删除文件时使用的 commit message，留空使用默认 picgo commit",
      },
    ];
  };
  return {
    uploader: "gitee",
    register,
    guiMenu,
  };
};
