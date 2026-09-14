# 重要通知
**Recently Gitee has not allowed repo to be used as personal website, so please refer to #11 and do your new plan. <br>
最近 gitee 不允许仓库作为个人图床，请参考 [#11](https://github.com/zhanghuid/picgo-plugin-gitee/issues/11)，做好相应的处理。**

# picgo-plugin-gitee

plugin for [PicGo](https://github.com/Molunerfinn/PicGo)

### Install

```bash
npm i picgo-plugin-gitee
```

### Usage

#### input your config
- owner: gitee project's owner name
- repo: gitee project repo
- path: img path in response json (eg:url or data.url), 根目录可留空
- token: gitee's api token（在 https://gitee.com/profile/personal_access_tokens 生成）
- customUrl: 自定义独立域名（可选），留空默认使用 `https://raw.giteeusercontent.com`，避免默认域名被 302 重定向
- message: gitee commit，默认 `picgo commit`

> 默认预览地址使用 [Gitee 独立域名 `raw.giteeusercontent.com`](https://help.gitee.com/repository/file-operate/raw#%E7%8B%AC%E7%AB%8B%E5%9F%9F%E5%90%8D)，不再走 `gitee.com` 的 302。 

#### init your remote repo
- create git repo?
```bash
mkdir resources
cd resources
git init
touch README.md
git add README.md
git commit -m "first commit"
git remote add origin your-remote-link
git push -u origin master
```
- exists repo?
```
cd existing_git_repo
git remote add origin your-remote-link
git push -u origin master
```

### Feature
- support sync gitee file delete
- 上传/删除结束均会弹出系统通知（PicGo 消息中心）

### Todo

- [x] trim / delimiter


**gitee文件大小有1mb限制, 所以超过1mb的文件无法通过外链获取**
