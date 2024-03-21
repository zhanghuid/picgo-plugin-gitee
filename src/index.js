const uploadedName = "gitee";
const domain = "https://gitee.com";
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
      domain + "/api/v5/repos/" + userConfig.owner + "/" + userConfig.repo;
    userConfig["previewUrl"] =
      domain +
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
      } catch (err) {
        ctx.log.info("[上传操作]异常：" + err.message);
        // duplicate file, so continue
        if (checkIsDuplicateFile(err.message)) {
          ctx.emit("notification", {
            title: "上传失败",
            body: "文件已经存在了",
          });
          continue;
        } else {
          ctx.emit("notification", {
            title: "上传失败",
            body: JSON.stringify(err),
          });
        }
      }

      delete imgList[i].base64Image;
      delete imgList[i].buffer;
    }

    return ctx;
  };

  const checkIsDuplicateFile = (message) => {
    return message.indexOf("A file with this name already exists") != -1;
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
    // log request params
    const rms = files.filter((each) => each.type === uploadedName);
    if (rms.length === 0) {
      return;
    }

    ctx.log.info("删除个数:" + rms.length);
    ctx.log.info("uploaded 信息:");
    let headers = getHeaders();
    let config = getUserConfig();
    const fail = [];

    for (let i = 0; i < rms.length; i++) {
      const each = rms[i];
      let filepath = getFilePath(each.imgUrl);
      let sha = await getSha(filepath).catch((err) => {
        ctx.log.info("[删除操作]获取sha值：" + JSON.stringify(err));
      });

      let url =
        `${filepath}` +
        `?access_token=${config.token}` +
        `&message=${config.message}` +
        `&sha=${sha}`;
      ctx.log.info("[删除操作]当前删除地址：" + url);
      let opts = {
        method: "DELETE",
        url: encodeURI(url),
        headers: headers,
      };
      ctx.log.info("[删除操作]当前参数" + JSON.stringify(opts));
      // log request params
      response = await ctx.request(opts);
      ctx.log.info(response);
    }

    ctx.emit("notification", {
      title: "删除提示",
      body: fail.length === 0 ? "成功同步删除" : `删除失败${fail.length}个`,
    });
  };

  const getFilePath = function (url) {
    let pathInfo = urlParser.parse(url);
    let baseUrl = pathInfo.protocol + "//" + pathInfo.host;
    let urlStr = url.replace(baseUrl, baseUrl + "/api/v5/repos");
    return urlStr.replace("raw/master", "contents");
  };

  const getSha = async function (filepath) {
    let config = getUserConfig();
    let headers = getHeaders();
    let url = `${filepath}` + `?access_token=${config.token}`;

    const opts = {
      method: "GET",
      url: encodeURI(url),
      headers: headers,
    };

    let res = await ctx.Request.request(opts);
    let tmp = JSON.parse(res);

    return tmp.sha;
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
      // {
      //   name: 'url',
      //   type: 'input',
      //   default: userConfig.url,
      //   required: true,
      //   message: 'https://gitee.com',
      //   alias: 'url'
      // },
      {
        name: "owner",
        type: "input",
        default: userConfig.owner,
        required: true,
        message: "owner",
        alias: "owner",
      },
      {
        name: "repo",
        type: "input",
        default: userConfig.repo,
        required: true,
        message: "repo",
        alias: "repo",
      },
      {
        name: "path",
        type: "input",
        default: userConfig.path,
        required: false,
        message: "path;根目录可不用填",
        alias: "path",
      },
      {
        name: "token",
        type: "input",
        default: userConfig.token,
        required: true,
        message: "5664b5620fb11111e3183a98011113ca31",
        alias: "token",
      },
      {
        name: "message",
        type: "input",
        default: userConfig.message,
        required: false,
        message: defaultMsg,
        alias: "message",
      },
    ];
  };
  return {
    uploader: "gitee",
    register,
  };
};
