# ENV

## Error

'''
yarn install 00h00m00s 0/0: : ERROR: [Errno 2] No such file or directory: 'install'
'''
Run:
'''
sudo apt remove cmdtest
sudo apt remove yarn
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt-get update
sudo apt-get install yarn -y
'''

install nodejs correct version
'''
$ sudo apt-get remove nodejs
$ sudo apt-get remove npm

$ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.2/install.sh | bash
$ chmod +x ~/.nvm/nvm.sh
$ source ~/.bashrc

$ nvm -v
0.39.2

$ nvm install 16.15.1

$ node -v

$ npm -v

'''

## Errors

### Error 1

'''
node: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.28' not found (required by node)

'''
Solution is install node 16.15.1

### error 2

When we run 'yarn install', we meet the problem:
'''
version https://git-lfs.github.com/spec/v1

SyntaxError: Unexpected identifier
'''
Solution is Install git lfs
'''
curl -s https://packagecloud.io/install/repositories/github/git-lfs/script.deb.sh | sudo bash
sudo apt-get install git-lfs
'''

# Package

npm i -g electron-builder
npm i dmg-license

# Structure

## folders

- 'benchmark':
- 'dist':
- 'node_modules':
- 'packages':
- 'patches':
- 'resources':
- 'ci':

## Configuration files

- 'index.html': loads the bundled JavaScript
- 'index.ts': the source code of the webpack-typescript app
- 'package.json': dependens of the web app
- 'tsconfig.json': The presence of a tsconfig.json file in a directory indicates that the directory is the root of a TypeScript project. The tsconfig.json file specifies the root files and the compiler options required to compile the project. T
  he compiler's config options,common tsc option
- 'webpack.config.js': the Webpack configuration file
- 'index.js': the source code of the babel-javascript app
- 'jest.config.json'
- 'webpack.main.config.ts':
- 'webpack.preload.config.ts':
- '.d.ts': output declaration file

- 'tsc -w'

## Babel

When making a modern JavaScript project, you might ask yourself what is the right way to convert files from TypeScript to JavaScript?

- babel.config.json
