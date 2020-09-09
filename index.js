'use strict';

const app = require('express')();
//const bodyParser = require('body-parser');
const http = require('http').Server(app);
const io = require('socket.io')(http);
// const jwt = require('express-jwt');
// const jwks = require('jwks-rsa');
//const cors = require('cors');
const nedb = require('nedb');
const dayjs = require('dayjs');                                               

const port = process.env.PORT || 3000;

//app.use(bodyParser.json());
//app.use(bodyParser.urlencoded({ extended: true }));
//app.use(cors());

// Setup persistent database with automatic loading.
const timers = new nedb({ filename: './timers.db', autoload: true });

// Timer states.
const UNDEFINED = 'undefined';
const INACTIVE  = 'inactive';
const ACTIVE    = 'active';
const PAUSED    = 'paused';

// Error reasons.
const ERR_NOT_FOUND     = 'Timer not found.';
const ERR_DATABASE      = 'Database query failed.';
const ERR_INVALID_INPUT = 'Invalid timer set input.';
const ERR_SET_TIMER     = 'Cannot set a timer when active or paused.';
const ERR_START_TIMER   = 'Cannot start an undefined or active timer.';
const ERR_PAUSE_TIMER   = 'Cannot pause a stopped, undefined or already paused timer.';
const ERR_STOP_TIMER    = 'Cannot stop an inactive or undefined timer.';

io.on('connection', socket => { 
    socket.on('get', eventName => {
        console.log(eventName + '.show()');
        timers.findOne({ 'event': eventName }, (err, doc) => {
            // Database request failed.
            if (err) {
                socket.emit('err', ERR_DATABASE);
                return;
            }

            // No timer found.
            if (doc == null) {
                socket.emit('err', ERR_NOT_FOUND);
                return;
            }

            // Return requested timer data.
            socket.emit('timer', {
                'state': doc.state,
                'enddate': doc.enddate,
            });
        });
    });

    socket.on('set', timerData => {
        let eventName = timerData.eventName;
        let duration = timerData.duration;

        console.log(eventName + '.set(' + duration + ')');

        // Validate data.
        if (duration.h > 24 || duration.m > 60 || duration.s > 60) {
            socket.emit('err', ERR_INVALID_INPUT);
            return;
        }

        timers.findOne({ 'event': eventName }, (err, doc) => {
            // Database request failed.
            if (err) {
                socket.emit('err', ERR_DATABASE);
                return;
            }

            // Cannot set a timer when it is active or paused.
            if (doc != null && (doc.state == ACTIVE || doc.state == PAUSED)) {
                socket.emit('err', ERR_SET_TIMER);
                return;
            }

            let pauseddate = dayjs().toISOString();
            let enddate = dayjs()
                    .add(duration.d, 'd')
                    .add(duration.h, 'h')
                    .add(duration.m, 'm')
                    .add(duration.s, 's').toISOString();

            let timer = {
                'event': eventName,
                'state': INACTIVE,
                'enddate': enddate,
                'pauseddate': pauseddate,
            };

            // Create new database entry for timer or update the existing one.
            timers.update(
                { 'event': eventName },
                timer,
                { multi: false, upsert: true, returnUpdatedDocs: true },
                (err, count, doc, upsert) => {
                    // Return requested timer data.
                    socket.emit('timer', {
                        'state': doc.state,
                        'enddate': doc.enddate,
                    });
                }
            );
        });
    });

    socket.on('start', eventName => {
        console.log(eventName + '.start()');

        timers.findOne({ 'event': eventName }, (err, doc) => {
            // Database request failed.
            if (err) {
                socket.emit('err', ERR_DATABASE);
                return;
            }

            // No timer was created.
            if (doc == null) {
                socket.emit('err', ERR_NOT_FOUND);
                return;
            }

            // Cannot start an undefined or already active timer.
            if (doc.state == ACTIVE || doc.state == UNDEFINED) {
                socket.emit('err', ERR_START_TIMER);
                return;
            }
            
            let enddate = dayjs(doc.enddate)
                            .add(dayjs().diff(dayjs(doc.pauseddate)))
                            .toISOString();

            timers.update(
                { 'event': eventName },
                { $set: { 'state': ACTIVE, 'enddate': enddate } },
                { multi: false, upsert: false, returnUpdatedDocs: true },
                (err, count, doc, upsert) => {
                    socket.emit('timer', {
                        'state': doc.state,
                        'enddate': doc.enddate,
                    });
                }
            );
        });
    });

    socket.on('pause', eventName => {
        console.log(eventName + '.pause()');

        timers.findOne({ 'event': eventName }, (err, doc) => {
            // Database request failed.
            if (err) {
                socket.emit('err', ERR_DATABASE);
                return;
            }

            // Cannot pause a stopped, already paused or undefined timer.
            if (doc.state == PAUSED ||
                doc.state == INACTIVE ||
                doc.state == UNDEFINED) {

                socket.emit('err', ERR_PAUSE_TIMER);
                return;
            }

            timers.update(
                { 'event': eventName },
                { $set: { 'state': PAUSED, 'pauseddate': dayjs().toISOString() } },
                { multi: false, upsert: false, returnUpdatedDocs: true },
                (err, count, doc, upsert) => {
                    socket.emit('timer', {
                        'state': doc.state,
                        'enddate': doc.enddate,
                    });
                }
            );
        });
    });

    socket.on('stop', eventName => {
        console.log(eventName + '.stop()');

        timers.findOne({ 'event': eventName }, (err, doc) => {
            // Database request failed.
            if (err) {
                socket.emit('err', ERR_DATABASE);
                return;
            }

            // Cannot stop an inactive or undefined timer.
            if (doc.state == INACTIVE || doc.state == UNDEFINED) {
                socket.emit('err', ERR_STOP_TIMER);
                return;
            }

            timers.update(
                { 'event': eventName },
                { $set: { 'state': UNDEFINED, 'enddate': '', 'pauseddate': '' } },
                { multi: false, upsert: false, returnUpdatedDocs: true },
                (err, count, doc, upsert) => {
                    socket.emit('timer', {
                        'state': doc.state,
                        'enddate': doc.enddate,
                    });
                }
            );
        });
    });
    
});

  // let previousId;
  // const safeJoin = currentId => {
  //   socket.leave(previousId);
  //   socket.join(currentId);
  //   previousId = currentId;
  // };

  // socket.on("getDoc", docId => {
  //   safeJoin(docId);
  //   socket.emit("document", documents[docId]);
  // });

  // socket.on("addDoc", doc => {
  //   documents[doc.id] = doc;
  //   safeJoin(doc.id);
  //   io.emit("documents", Object.keys(documents));
  //   socket.emit("document", doc);
  // });

  // socket.on("editDoc", doc => {
  //   documents[doc.id] = doc;
  //   socket.to(doc.id).emit("document", doc);
  // });

  // io.emit("documents", Object.keys(documents));


// // socket.io setup.
// io.on('connection', (socket) => {
//     console.log('user connected');
// });

// // Listen for messages. Send back messages to all the connected users.
// io.on('new-message', (message) => {
//   io.emit(message);
// });

http.listen(port);
