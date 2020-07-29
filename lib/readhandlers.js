'use strict';

var assert = require('assert'),
    thing = require('core-util-is'),
    path = require('path'),
    fs = require('fs'),
    domain = require('domain'),
    cluster = require('cluster'),
    process = require('process');

/**
 * Reads the given path and requires all .js files.
 * @param path
 * @returns {{}}
 */
function read(dir) {
    var handlers;

    if (thing.isString(dir)) {
        assert.ok(fs.existsSync(dir), 'Specified or default \'handlers\' directory does not exist.');

        handlers = {};

        fs.readdirSync(dir).forEach(function (name) {
            var abspath, key, stat;

            abspath = path.join(dir, name);
            stat = fs.statSync(abspath);
            key = name.replace(/\.js/, '');

            if (stat.isFile()) {
                if (name.match(/^.*\.(js)$/)) {
                    const obj = require(abspath);

                    if (!handlers[key]) {
                        handlers[key] = {};
                    }

                    Object.keys(obj).forEach(function (k) {
                        handlers[key][isHttpMethod(k) ? '$' + k.toLowerCase() : k] = (req, res, next) => {
                            // Create a domain for this request to handle errors
                            const d = domain.create();
                            d.on('error', err => {
                                // We need to die, but gracefully send 500 and let concurrent connections finish
                                console.error("Domain caught error; rendering 500. Error: %s", err.stack ? err.stack : err);
                                console.error("Process will exit within 10 seconds to avoid resource leaking.");
                                const killTimer = setTimeout(() => {
                                    process.exit(1);
                                }, 10000);
                                killTimer.unref();
                                if (!cluster.worker.isDying) {
                                    cluster.worker.isDying = true;
                                    process.send('willDisconnect');
                                    if (process.env.EXPERIMENTAL_SLOW_DISCONNECT === '1') {
                                        // Accept connections for a few more seconds
                                        setTimeout(() => {
                                            cluster.worker.disconnect();
                                        }, 8000);
                                    } else {
                                        cluster.worker.disconnect();
                                    }
                                }
                                try {
                                    res.statusCode = 500;
                                    res.setHeader('content-type', 'text/plain');
                                    res.end('An internal server error occurred!\n');
                                } catch (er2) {
                                    console.error(`Error sending 500! ${er2.stack}`);
                                }
                                next();
                            })
                            d.add(req);
                            d.add(res);

                            // Run the handler, knowing that errors will be caught above
                            d.run(() => {
                                obj[k](req, res, next);
                            });
                        };
                    });
                }
            }
            if (stat.isDirectory()) {
                handlers[key] = read(abspath);
            }
        });

        return handlers;
    }

    return dir;
}

/**
 * Determines if the given method is a supported HTTP method.
 * @param method
 * @returns {boolean}
 */
function isHttpMethod(method) {
    return (typeof method === 'string') && {
        get: 'GET',
        post: 'POST',
        put: 'PUT',
        delete: 'DELETE',
        head: 'HEAD',
        options: 'OPTIONS',
        trace: 'TRACE',
        connect: 'CONNECT',
        patch: 'PATCH'
    }.hasOwnProperty(method.toLowerCase());
}

module.exports = read;
