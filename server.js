const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.QUIZ_PASSWORD || 'formazione2026';

let questions = [];
try {
  questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
} catch (e) {
  console.error('⚠️  Errore nel caricamento di questions.json:', e.message);
  process.exit(1);
}

const state = {
  phase: 'waiting', // waiting | voting | closed | results | finished
  currentIndex: -1,
  votes: {},
  voters: new Set(),
  connections: 0,
};

function resetVotes() {
  state.votes = {};
  state.voters = new Set();
  if (state.currentIndex >= 0) {
    questions[state.currentIndex].answers.forEach((_, i) => {
      state.votes[i] = 0;
    });
  }
}

function buildState() {
  const q = state.currentIndex >= 0 ? questions[state.currentIndex] : null;
  const showVotes = state.phase === 'results' || state.phase === 'closed';
  return {
    phase: state.phase,
    questionIndex: state.currentIndex,
    totalQuestions: questions.length,
    question: q ? {
      text: q.question,
      emoji: q.emoji || '❓',
      answers: q.answers,
    } : null,
    votes: showVotes ? state.votes : null,
    totalVotes: state.voters.size,
    connections: state.connections,
  };
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/auth', (req, res) => {
  res.json({ ok: req.body.password === PASSWORD });
});

app.get('/api/info', (req, res) => {
  let localIP = 'localhost';
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  res.json({ ip: localIP, port: PORT, url: `http://${localIP}:${PORT}` });
});

io.on('connection', (socket) => {
  state.connections++;
  io.emit('connections', state.connections);
  socket.emit('state', buildState());

  socket.on('disconnect', () => {
    state.connections--;
    io.emit('connections', state.connections);
  });

  socket.on('action', ({ password: pwd, type }) => {
    if (pwd !== PASSWORD) return;

    const handlers = {
      next: () => {
        if ((state.phase === 'waiting' || state.phase === 'results') &&
            state.currentIndex < questions.length - 1) {
          state.currentIndex++;
          state.phase = 'voting';
          resetVotes();
          io.emit('state', buildState());
        }
      },
      close: () => {
        if (state.phase === 'voting') {
          state.phase = 'closed';
          io.emit('state', buildState());
        }
      },
      results: () => {
        if (state.phase === 'closed') {
          state.phase = 'results';
          io.emit('state', buildState());
        }
      },
      finish: () => {
        if (state.phase === 'results' && state.currentIndex === questions.length - 1) {
          state.phase = 'finished';
          io.emit('state', buildState());
        }
      },
      reset: () => {
        state.phase = 'waiting';
        state.currentIndex = -1;
        state.votes = {};
        state.voters = new Set();
        io.emit('state', buildState());
      },
    };

    if (handlers[type]) handlers[type]();
  });

  socket.on('vote', ({ index }) => {
    if (state.phase !== 'voting') return;
    if (state.voters.has(socket.id)) return;
    if (typeof state.votes[index] !== 'number') return;

    state.voters.add(socket.id);
    state.votes[index]++;

    socket.emit('voted', { index });
    io.emit('vote_update', { votes: state.votes, total: state.voters.size });
  });
});

server.listen(PORT, () => {
  let localIP = 'localhost';
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  console.log('\n🎯 Quiz Live avviato!\n');
  console.log(`   Regia (tu):    http://localhost:${PORT}/presenter.html`);
  console.log(`   Partecipanti:  http://${localIP}:${PORT}`);
  console.log(`   Password:      ${PASSWORD}\n`);
});
