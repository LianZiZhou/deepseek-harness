/** Materialize the Electron shell from the unsigned build without carrying a second dsh runtime. */
const { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const [archive, shell] = process.argv.slice(2)
mkdirSync(shell)

function materialize(source, destination) {
  const details = statSync(source)
  if (details.isDirectory()) {
    mkdirSync(destination)
    for (const name of readdirSync(source)) materialize(join(source, name), join(destination, name))
  } else {
    writeFileSync(destination, readFileSync(source), { flag: 'wx' })
    chmodSync(destination, details.mode & 0o777)
  }
}

for (const name of ['lib', 'renderer', 'node_modules', 'package.json']) {
  materialize(join(archive, name), join(shell, name))
}
