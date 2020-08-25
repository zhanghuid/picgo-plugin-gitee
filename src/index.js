
const uploadedName = 'gitee'
const domain = 'https://gitee.com'
const urlParser = require('url')
const defaultMsg = 'picgo commit'

module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register(uploadedName, {
      handle,
      name: 'Gitee图床',
      config: config
    })

    ctx.on('remove', onRemove)
  }

  const getHeaders = function () {
    return {
      contentType: 'application/json;charset=UTF-8',
      'User-Agent': 'PicGo'
    }
  }

  const getUserConfig = function () {
    let userConfig = ctx.getConfig('picBed.gitee')

    if (!userConfig) {
      throw new Error('Can\'t find uploader config')
    }

    userConfig['baseUrl'] = domain + '/api/v5/repos/' + userConfig.owner + '/' + userConfig.repo
    userConfig['previewUrl'] = domain + '/' + userConfig.owner + '/' + userConfig.repo + '/raw/master' + formatConfigPath(userConfig)

    return userConfig
  }

  // uploader
  const handle = async function (ctx) {
    let userConfig = getUserConfig()

    const realUrl = userConfig.baseUrl + '/contents' + formatConfigPath(userConfig)

    try {
      let imgList = ctx.output
      for (let i in imgList) {
        let image = imgList[i].buffer
        if (!image && imgList[i].base64Image) {
          image = Buffer.from(imgList[i].base64Image, 'base64')
        }

        let perRealUrl = realUrl + '/' + imgList[i].fileName
        const postConfig = postOptions(perRealUrl, image)
        // post config log
        // ctx.log.info(JSON.stringify(postConfig))
        let body = await ctx.Request.request(postConfig)
        delete imgList[i].base64Image
        delete imgList[i].buffer
        body = JSON.parse(body)
        imgList[i]['imgUrl'] = userConfig.previewUrl + '/' + imgList[i].fileName
      }
    } catch (err) {
      // log error message
      ctx.log.info(JSON.stringify(err))

      ctx.emit('notification', {
        title: '上传失败',
        body: JSON.stringify(err)
      })
    }
  }

  const postOptions = (url, image) => {
    let config = getUserConfig()
    let headers = getHeaders()
    let formData = {
      'access_token': config.token,
      'content': image.toString('base64'),
      'message': config.message || defaultMsg
    }
    const opts = {
      method: 'POST',
      url: encodeURI(url),
      headers: headers,
      formData: formData
    }
    return opts
  }

  // trigger delete file
  const onRemove = async function (files) {
    // log requsest params
    const rms = files.filter(each => each.type === uploadedName)
    if (rms.length === 0) {
      return
    }
    const fail = []
    for (let i = 0; i < rms.length; i++) {
      const each = rms[i]
      // delete gitee file
      deleteFile(rms[i].imgUrl).catch((err) => {
        ctx.log.info(JSON.stringify(err))
        fail.push(each)
      })
    }

    if (fail.length) {
      const uploaded = ctx.getConfig('uploaded')
      uploaded.unshift(...fail)
      ctx.saveConfig(uploaded)
    }

    ctx.emit('notification', {
      title: '删除提示',
      body: fail.length === 0 ? '成功同步删除' : `删除失败${fail.length}个`
    })
  }

  const getfilePath = function (url) {
    let pathInfo = urlParser.parse(url)
    let baseUrl = pathInfo.protocol + '//' + pathInfo.host
    let urlStr = url.replace(baseUrl, baseUrl + '/api/v5/repos')
    return urlStr.replace('raw/master', 'contents')
  }

  // delete file
  const deleteFile = async function (name) {
    let headers = getHeaders()
    let config = getUserConfig()
    let filepath = getfilePath(name)
    let sha = await getSha(filepath).catch((err) => {
      ctx.log.info(JSON.stringify(err))
    })

    let url = `${filepath}` + `?access_token=${config.token}` +
        `&message=${config.message}` +
        `&sha=${sha}`
    ctx.log.info(url)
    const opts = {
      method: 'DELETE',
      url: encodeURI(url),
      headers: headers
    }

    // log requsest params
    let res = await ctx.Request.request(opts)
    res = JSON.parse(res)
    return res
  }

  const getSha = async function (filepath) {
    let config = getUserConfig()
    let headers = {
      contentType: 'application/json;charset=UTF-8',
      'User-Agent': 'PicGo'
    }
    let url = `${filepath}` + `?access_token=${config.token}`

    ctx.log.info(url)
    const opts = {
      method: 'GET',
      url: url,
      headers: headers
    }

    let res = await ctx.Request.request(opts)
    let tmp = JSON.parse(res)
    ctx.log.info(tmp.sha)
    return tmp.sha
  }

  const formatConfigPath = function (userConfig) {
    return userConfig.path ? '/' + userConfig.path : ''
  }

  const config = ctx => {
    let userConfig = ctx.getConfig('picBed.gitee')
    if (!userConfig) {
      userConfig = {}
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
        name: 'owner',
        type: 'input',
        default: userConfig.owner,
        required: true,
        message: 'owner',
        alias: 'owner'
      },
      {
        name: 'repo',
        type: 'input',
        default: userConfig.repo,
        required: true,
        message: 'repo',
        alias: 'repo'
      },
      {
        name: 'path',
        type: 'input',
        default: userConfig.path,
        required: false,
        message: 'path;根目录可不用填',
        alias: 'path'
      },
      {
        name: 'token',
        type: 'input',
        default: userConfig.token,
        required: true,
        message: '5664b5620fb11111e3183a98011113ca31',
        alias: 'token'
      },
      {
        name: 'message',
        type: 'input',
        default: userConfig.message,
        required: false,
        message: defaultMsg,
        alias: 'message'
      }
    ]
  }
  return {
    uploader: 'gitee',
    register
  }
}
