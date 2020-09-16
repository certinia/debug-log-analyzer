global.__dirname = __dirname;

const conf = require("./config.json")

const { activate, deactivate } = require('./bundle.js');

exports.activate = ec => activate(ec, conf)

exports.deactivate = deactivate
