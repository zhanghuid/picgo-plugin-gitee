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

    // 上传结束后统一给一条汇总通知，避免每次上传都点弹窗打扰用户。
    if (successCount > 0) {
      ctx.emit("notification", {
        title: "上传完成",
        body: `成功 ${successCount} 张${failCount > 0 ? `，失败 ${failCount} 张` : ""}`,
      });
    }
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
  const onRemove = async function (files) {
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
        ctx.emit("notification", {
          title: "删除失败",
          body: `${each.fileName || each.imgUrl} 获取 sha 失败`,
        });
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
        ctx.emit("notification", {
          title: "删除失败",
          body: `${each.fileName || each.imgUrl} ${err.message}`,
        });
      }
    }

    // 汇总通知，避免重复打扰。
    if (successNames.length > 0) {
      ctx.emit("notification", {
        title: "删除完成",
        body:
          `成功同步删除 ${successNames.length} 个` +
          (fails.length > 0 ? `，失败 ${fails.length} 个` : ""),
      });
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
  };
};
