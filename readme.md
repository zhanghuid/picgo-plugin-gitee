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
- token: gitee's api token
- path: img path in response json (eg:url or data.url)
- message: gitee commit 

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

### Todo

- [x] trim / delimiter


**gitee文件大小有1mb限制, 所以超过1mb的文件无法通过外链获取**
