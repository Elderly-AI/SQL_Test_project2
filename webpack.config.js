const path = require('path');
const nodeExternals = require('webpack-node-externals')

module.exports = {
    entry: ['./main.js'] ,
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: '/'
    },
    externals: [nodeExternals()],
};
