/* eslint-env browser */
/* global io */
(function () {
  let currentFile = ''

  if (io) {
    const divFilelists = Array.from(document.getElementsByClassName('filelist'))
    const reload = io()

    reload.on('list', function (filelist) {
      console.debug('[LIST]')
      console.debug('Params= %o', { filelist })
      divFilelists.forEach(function (divFilelist) {
        divFilelist.innerHTML = ''

        filelist.forEach(function (file) {
          const liFile = divFilelist.appendChild(document.createElement('li'))
          liFile.addEventListener('click', function () {
            reload.emit('open', file.fid)
          })
          if (currentFile === file.fid) {
            liFile.classList.add('active')
          }

          const filepill = liFile.appendChild(document.createElement('div'))
          filepill.classList.add('filename')
          filepill.innerHTML = filepill.name = file.name
          filepill.fid = file.fid
        })
      })
    })

    reload.on('file', function (meta, content) {
      console.debug('[FILE]')
      console.debug('Params= %o', { meta, content })

      content = typeof content === 'string' ? content : ''

      document.getElementById('content').innerHTML = content
      Array.from(document.getElementsByTagName('ol'))
        .concat(Array.from(document.getElementsByTagName('ul')))
        .forEach(function (list) {
          list.querySelectorAll('li>.cb-container').forEach(function (ct) {
            ct.parentNode.classList.add('has-cb')
          })
        })

      Array.from(document.getElementsByClassName('filename')).forEach(function (filepill) {
        if (typeof meta === 'object' && filepill.fid === meta.fid) {
          filepill.parentNode.classList.add('active')
          currentFile = meta.fid

          window.history.pushState(null, filepill.name, (meta.path.charAt(0) === '/' ? '' : '/') + meta.path)
        } else {
          filepill.parentNode.classList.remove('active')
        }
      })
    })

    reload.emit('join', location.pathname)
  }
})()
