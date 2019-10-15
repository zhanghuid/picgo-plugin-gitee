// fork from : https://github.com/yuki-xin/picgo-plugin-web-uploader

module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register('gitee', {
      handle,
      name: 'Gitee图床',
      config: config
    })
  }
  const handle = async function (ctx) {
    let userConfig = ctx.getConfig('picBed.gitee')
    if (!userConfig) {
      throw new Error('Can\'t find uploader config')
    }
    const baseUrl = userConfig.url
    const owner = userConfig.owner
    const repo = userConfig.repo
    const path = userConfig.path
    const token = userConfig.token
    const message = userConfig.message
    const realImgUrlPre = baseUrl + '/' + owner + '/' + repo + '/raw/master/' + path
    const realUrl = baseUrl + '/api/v5/repos/' + owner + '/' + repo + '/contents/' + path

    try {
      let imgList = ctx.output
      for (let i in imgList) {
        let image = imgList[i].buffer
        if (!image && imgList[i].base64Image) {
          image = Buffer.from(imgList[i].base64Image, 'base64')
        }

        let perRealUrl = realUrl + '/' + imgList[i].fileName
        const postConfig = postOptions(perRealUrl, token, image, message)
        // post config log
        ctx.log.info(JSON.stringify(postConfig))
        let body = await ctx.Request.request(postConfig)
        delete imgList[i].base64Image
        delete imgList[i].buffer
        body = JSON.parse(body)
        imgList[i]['imgUrl'] = realImgUrlPre + '/' + imgList[i].fileName
      }
    } catch (err) {
      // ctx.log.info(JSON.stringify(err))
      ctx.emit('notification', {
        title: '上传失败',
        body: JSON.stringify(err)
      })
    }
  }

  const postOptions = (url, token, image, message) => {
    let headers = {
      contentType: 'application/json;charset=UTF-8',
      'User-Agent': 'PicGo'
    }
    let formData = {
      'access_token': token,
      'content': image.toString('base64'),
      'message': message || ''
    }
    const opts = {
      method: 'POST',
      url: url,
      headers: headers,
      formData: formData
    }
    return opts
  }

  const config = ctx => {
    let userConfig = ctx.getConfig('picBed.gitee')
    if (!userConfig) {
      userConfig = {}
    }
    return [
      {
        name: 'url',
        type: 'input',
        default: userConfig.url,
        required: true,
        message: 'https://gitee.com',
        alias: 'url'
      },
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
        required: true,
        message: 'path',
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
        message: '测试',
        alias: 'message'
      }
    ]
  }
  return {
    uploader: 'gitee',
    register

  }
}
