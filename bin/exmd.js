#!/usr/bin/env node
const MARKDOWN_EXTNAME = [
  '.md'
]
const UI_CHECKBOX = function (checked) {
  return `
    <label class="cb-container">
      <input type="checkbox" ${checked ? 'checked' : ''} onclick="return false;">
      <span class="checkmark"></span>
    </label>`
}

const uuidv4 = require('uuid/v4')
const uuidv5 = require('uuid/v5')

const path = require('path')
const EXMD_UUID = uuidv4()
const EXMD_ROOT = path.dirname(__dirname)
const APPJS_PATH = path.join(EXMD_ROOT, 'assets', 'app.js')
const VIEW_PATH = path.join(EXMD_ROOT, 'assets', 'index.html')
const DEFAULT_ICON_PATH = path.join(EXMD_ROOT, 'assets', 'favicon.ico')
const PKG = require(path.join(EXMD_ROOT, 'package.json'))

const program = require('commander')
  .version(PKG.version)
  .option('-f, --favicon <icon path>', 'A path of the icon file', DEFAULT_ICON_PATH)
  .option('-H, --host <host>', 'Server host', '0.0.0.0')
  .option('-p, --port <port>', 'Server port', parseInt, 2266)
  .option('-t, --title <title>', 'Website title', 'Markdown Live')
  .option('-v, --verbose', 'Enable debugEX messages', false)
  .parse(process.argv)

if (program.verbose) {
  process.env.DEBUG = [
    PKG.name,
    PKG.name + ':express',
    PKG.name + ':socket.io'
  ].join(',')
}

const bluebird = require('bluebird')
const fs = require('fs')
const debug = require('debug')(PKG.name)
const debugEX = require('debug')(PKG.name + ':express')
const debugIO = require('debug')(PKG.name + ':socket.io')
const express = require('express')
const marked = bluebird.promisify(require('marked'))
const sane = require('sane')

const lstat = bluebird.promisify(fs.lstat)
const readdir = bluebird.promisify(fs.readdir)
const readFile = bluebird.promisify(fs.readFile)
const app = express()
const watchers = {} // maps room ID with a FSWatcher
const sockState = {}
const fid2path = {}

function sendFile (filepath, res, next) {
  res.sendFile(filepath, function (err) {
    if (err) {
      debugEX('Cannot send file at "%s", pass to the next middleware.', filepath)
      return next(err)
    }
    debugEX('File at "%s" is sent', filepath)
  })
}

async function isDirectory (targetPath) {
  const stats = await lstat(targetPath).catch(function (err) {
    debug('Failed to lstat "%s"', targetPath)
    debug(err)
  })

  return stats ? stats.isDirectory() : false
}

async function isFile (targetPath) {
  const stats = await lstat(targetPath).catch(function (err) {
    debug('Failed to lstat "%s"', targetPath)
    debug(err)
  })

  return stats ? stats.isFile() : false
}

async function getFiles (targetPath) {
  if (await isDirectory(targetPath)) {
    const files = await readdir(targetPath).catch(function (err) {
      debug('Failed to readdir "%s"', targetPath)
      debug(err)
      return []
    })

    return files.filter(async function (file) {
      return isFile(path.join(targetPath, file))
    })
  } else if (await isFile(targetPath)) {
    return [ targetPath ]
  } else {
    return []
  }
}

async function refreshList (targetDir, onError) {
  debugIO('Refreshing file list at "%s"', targetDir)

  const ROOM_ID = uuidv5(targetDir, EXMD_UUID)
  let files = await getFiles(targetDir).catch(function (err) {
    debugIO('Failed to refresh with the requested path, "%s"', targetDir)
    debugIO(err)
    if (typeof onError === 'function') onError(err)
    return []
  })

  files = files.filter(function (file) {
    return MARKDOWN_EXTNAME.includes(path.extname(file))
  }).map(function (file) {
    const fid = uuidv5(path.relative(process.cwd(), path.resolve(targetDir, file)), EXMD_UUID)
    fid2path[fid] = path.resolve(targetDir, file)
    return {
      name: file,
      fid
    }
  })

  fid2path[ROOM_ID] = targetDir

  io.in(ROOM_ID).emit('list', files)
  return files
}

async function refreshFile (targetMdFile) {
  debugIO('Refreshing file at "%s"', targetMdFile)

  const relPath = path.relative(process.cwd(), path.resolve(targetMdFile))
  const fileId = uuidv5(relPath, EXMD_UUID)
  let content = await readFile(targetMdFile, { encoding: 'utf8' })

  io.in(fileId).emit(
    'file',
    { fid: fileId, path: relPath },
    (await marked(content, { gfm: true }))
      .replace(/\[\]/g, UI_CHECKBOX(false))
      .replace(/\[x\]/g, UI_CHECKBOX(true))
  )
}

function leaveFileRoom (sock) {
  debugIO('Leaving File Room "%s" (%s)', sockState[sock.id].file, fid2path[sockState[sock.id].file])
  io.in(sockState[sock.id].file).emit('file')
  sock.leave(sockState[sock.id].file)
  sockState[sock.id].file = undefined
}

function joinFileRoom (sock, filePath) {
  debugIO('Joining File Room "%s" (%s)', filePath, fid2path[sockState[sock.id].file])
  if (!MARKDOWN_EXTNAME.includes(path.extname(filePath))) {
    debugIO('The specified path does not match with any valid file extensions.')
    return
  }

  const FILE_ID = uuidv5(path.relative(process.cwd(), filePath), EXMD_UUID)

  debugIO('Joining File Room "%s" (%s)', FILE_ID, filePath)
  sock.join(FILE_ID, function (err) {
    if (err) {
      debugIO('Failed to join File Room "%s" (%s)', FILE_ID, filePath)
      debugIO(err)
      return
    }

    sockState[sock.id].file = FILE_ID
    refreshFile(filePath)
  })
}

debug('Options: %o', program.opts())

app
  // all-route logging
  .all('*', function (req, res, next) {
    debugEX('A request is coming from %s with requested URL: %s', req.ip, req.url)
    next()
  })
  // github-markdown.css
  .get(/.*?\/github-markdown\.css$/, function (req, res, next) {
    debugEX('Sending github-markdown.css')
    let GHMdCss = ''
    try {
      GHMdCss = require.resolve('github-markdown-css')
    } catch (err) {
      debugEX('No github-markdown-css is found. Maybe you have not installed it yet?')
      return next(err)
    }

    sendFile(GHMdCss, res, next)
  })
  // app.js
  .get(/.*?\/app\.js$/, function (req, res, next) {
    debugEX('Sending app.js')
    sendFile(APPJS_PATH, res, next)
  })
  // favicon.ico, favicon.jpg or favicon.png
  .get(/.*?\/favicon\.(ico|png|jpg)$/, async function (req, res, next) {
    let faviconPath = path.resolve(process.cwd(), program.favicon)
    debugEX('Using favicon at "%s"', faviconPath)
    sendFile(faviconPath, res, next)
  })
  // socket.io[.slim].js[.map]
  .get(/.*?\/socket\.io(\.slim)?\.js(\.map)?/, function (req, res, next) {
    debugEX('Sending socket.io.js')
    let ioClient = ''
    try {
      ioClient = require.resolve('socket.io-client')
    } catch (err) {
      debugEX('No socket.io-client is found. Maybe you have not installed it yet?')
      return next(err)
    }

    for (let dirname = path.basename(ioClient), prev = '';
      prev !== ioClient;
      prev = ioClient, ioClient = path.dirname(ioClient), dirname = path.basename(ioClient)) {
      if (dirname === 'socket.io-client') {
        const clientDist = path.join(ioClient, 'dist', path.basename(req.path))
        if (fs.existsSync(clientDist)) {
          sendFile(clientDist, res, next)
        } else {
          debug('The file is not found at "%s", pass to the next middleware.', clientDist)
          next()
        }
        return
      }
    }
  })
  // index.html
  .use(function (req, res) {
    debugEX('Sending index.html')
    fs.readFile(VIEW_PATH, { encoding: 'utf8' }, function (err, content) {
      if (err) {
        debugEX('Cannot read file at "%s", pass to the next middleware.', VIEW_PATH)
        return res.status(500).end()
      }

      let placeholder
      let output = content
      const formatter = /\{\{(.*?)\}\}/g
      while ((placeholder = formatter.exec(content)) !== null) {
        let replacement = placeholder[1] === 'favicon'
          ? path.relative(process.cwd(), program.favicon.replace('.ico', '.png')).replace(/\\/g, '/')
          : program[placeholder[1]]
        output = output.replace(new RegExp(placeholder[0], 'g'), replacement)
      }

      res.status(200).send(output)
    })
  })
  // static files
  .use(express.static(process.cwd(), {
    index: false
  }))

const server = app.listen(program.port, program.host, function () {
  const { port, address } = server.address()
  debug('Express-marked server is starting at %s:%d', address, port)
})

const io = require('socket.io')(server)
io.on('connection', function (sock) {
  sockState[sock.id] = { }

  sock.on('join', async function (target) {
    debugIO('[JOIN]')

    let originalAbs = path.resolve(process.cwd(), './' + target)
    let isFileTarget = await isFile(originalAbs)
    // ensure requestedPath to be a directory
    let requestedPath = isFileTarget ? path.dirname(originalAbs) : originalAbs

    const ROOM_ID = uuidv5(requestedPath, EXMD_UUID)
    watchers[ROOM_ID] = watchers[ROOM_ID] || sane(requestedPath, {
      glob: MARKDOWN_EXTNAME.map(function (ext) {
        return '*' + ext
      })
    }).on('ready', function () {
      debug('Sane: READY event')
      debug('Sane: Ready to watch files under "%s"', requestedPath)
    }).on('add', async function () {
      debug('Sane: ADD event')

      let files = await refreshList(requestedPath, function () {
        sock.emit('exception', 'Cannot refresh the file list under the current directory.')
      })

      if (files.length > 0 && !sockState[sock.id].file) {
        joinFileRoom(sock, path.resolve(requestedPath, files[0].name))
      }
    }).on('change', function (file) {
      debug('Sane: CHANGE event')

      refreshFile(path.resolve(requestedPath, file))
    }).on('delete', async function (file) {
      debug('Sane: DELETE event')

      await refreshList(requestedPath, function () {
        sock.emit('exception', 'Cannot refresh the file list under the current directory.')
      })

      const deletedFileId = uuidv5(path.relative(process.cwd(), path.resolve(requestedPath, file)), EXMD_UUID)
      if (sockState[sock.id].file === deletedFileId) leaveFileRoom(sock)
    })

    debugIO('Joining Directory Room "%s" (%s)', ROOM_ID, requestedPath)

    sock.join(ROOM_ID, async function (err) {
      if (err) {
        debugIO('Failed to join Directory Room "%s" (%s)', ROOM_ID, requestedPath)
        debugIO(err)
        return
      }

      sockState[sock.id].dir = ROOM_ID

      let files = await refreshList(requestedPath, function () {
        sock.emit('exception', 'Cannot refresh the file list under the current directory.')
      })

      if (files.length > 0) {
        joinFileRoom(sock, isFileTarget ? originalAbs : path.resolve(requestedPath, files[0].name))
      }
    })
  })

  sock.on('open', function (fid) {
    debugIO('[OPEN]')

    const openFileRoom = function () {
      sock.join(fid, function (err) {
        if (err) {
          debugIO('Failed to join File Room "%s" (%s)', fid)
          debugIO(err)
          return
        }

        sockState[sock.id].file = fid
        refreshFile(fid2path[fid])
      })
    }

    if (sockState[sock.id].file) {
      sock.leave(sockState[sock.id].file, function (err) {
        if (err) {
          debugIO('Failed to leave File Room "%s"', sockState[sock.id].file)
          debugIO(err)
          return
        }

        sockState[sock.id].file = ''

        openFileRoom()
      })
    } else {
      openFileRoom()
    }
  })
})

process.on('exit', function () {
  io.emit('offline')
})
