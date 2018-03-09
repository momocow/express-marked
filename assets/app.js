/* eslint-env browser */
/* global io */

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
    document.getElementById('content').innerHTML = content
    Array.from(document.getElementsByClassName('filename')).forEach(function (filepill) {
      if (filepill.fid === meta.fid) {
        filepill.parentNode.classList.add('active')
      } else {
        filepill.parentNode.classList.remove('active')
      }
    })
  })

  reload.emit('join', location.pathname)
}
