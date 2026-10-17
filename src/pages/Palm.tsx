import { useEffect, useState } from 'react';
import { makeQuestions, QUESTION_COUNT, type Question, type Section } from '../games/palm/model';
import { SHOPS } from '../games/palm/shops';
import { HorizontalBandMap, type SectionState } from './PalmMiniMapPatterns';
import './Palm.css';

type Answer = { question: Question; chosen: number; correct: boolean };

type Screen = { name: 'start' } | { name: 'play'; questions: Question[] } | { name: 'result'; answers: Answer[] };

type StartProps = { onStart: () => void };

const PalmStart = ({ onStart }: StartProps) => (
  <div className='palm-start'>
    <p className='palm-lead'>武蔵小山パルム商店街の店の場所を覚えよう。全{QUESTION_COUNT}問です。</p>
    <button type='button' className='palm-primary' onClick={onStart}>
      スタート
    </button>
  </div>
);

type PlayProps = { questions: Question[]; onFinish: (answers: Answer[]) => void; onQuit: () => void };

const sameSectionOf = (a: Section, b: Section): boolean => a.area === b.area && a.side === b.side;

// 区画当ての答え合わせ用に、正解の区画を緑、選んだ不正解の区画を赤にする。
type SectionMark = { section: Section; state: SectionState };

const sectionStatesOf = (answer: Answer): SectionMark[] =>
  answer.question.choices.flatMap<SectionMark>((choice, i) => {
    if (!choice.section) return [];
    if (choice.correct) return [{ section: choice.section, state: 'correct' }];
    if (answer.chosen === i) return [{ section: choice.section, state: 'wrong' }];
    return [];
  });

const PalmPlay = ({ questions, onFinish, onQuit }: PlayProps) => {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const index = answers.length;
  // 回答してから「次へ」を押すまでは答え合わせを表示する。
  const [revealed, setRevealed] = useState(false);
  const current = revealed ? answers[index - 1] : null;
  const question = current ? current.question : questions[index];

  const choose = (choiceIndex: number) => {
    if (revealed) return;
    const correct = question.choices[choiceIndex].correct;
    setAnswers([...answers, { question, chosen: choiceIndex, correct }]);
    setRevealed(true);
  };

  const next = () => {
    if (answers.length >= questions.length) {
      onFinish(answers);
      return;
    }
    setRevealed(false);
  };

  const chooseSection = (section: Section) => {
    const choiceIndex = question.choices.findIndex(
      (choice) => choice.section && sameSectionOf(choice.section, section)
    );
    if (choiceIndex < 0) return;
    choose(choiceIndex);
  };

  const number = revealed ? index : index + 1;

  return (
    <div className='palm-play'>
      <header className='palm-header'>
        <button type='button' className='palm-text-button' onClick={onQuit}>
          やめる
        </button>
        <span>
          {number} / {questions.length}
        </span>
      </header>
      <p className='palm-question'>{question.text}</p>
      {question.hintShops && <HorizontalBandMap shops={SHOPS} marked={question.hintShops} hideLabels />}
      {question.kind === 'section' ? (
        <div className='palm-section-picker'>
          <p className='palm-map-note'>地図の区画をタップして答えてね（上の列が左側、下の列が右側）</p>
          <HorizontalBandMap
            shops={SHOPS}
            marked={[]}
            onSectionSelect={revealed ? undefined : chooseSection}
            sectionStates={current ? sectionStatesOf(current) : undefined}
          />
        </div>
      ) : (
        <div className='palm-choices'>
          {question.choices.map((choice, i) => {
            const state = !current ? '' : choice.correct ? ' is-correct' : current.chosen === i ? ' is-wrong' : '';
            return (
              <button
                key={choice.label}
                type='button'
                className={`palm-choice${state}`}
                disabled={revealed}
                onClick={() => choose(i)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      )}
      {current && (
        <section className='palm-feedback' aria-live='polite'>
          <p className={`palm-judge ${current.correct ? 'is-correct' : 'is-wrong'}`}>
            {current.correct ? '○ 正解！' : '✕ ざんねん'}
          </p>
          <HorizontalBandMap shops={SHOPS} marked={current.question.shops} />
          <button type='button' className='palm-primary' onClick={next}>
            {answers.length >= questions.length ? '結果を見る' : '次へ'}
          </button>
        </section>
      )}
    </div>
  );
};

type ResultProps = { answers: Answer[]; onRetry: () => void; onTop: () => void };

const PalmResult = ({ answers, onRetry, onTop }: ResultProps) => {
  const correctCount = answers.filter((answer) => answer.correct).length;

  return (
    <div className='palm-result'>
      <p className='palm-result-main'>
        {answers.length}問中 <strong>{correctCount}</strong>問正解！
      </p>
      <section className='palm-review'>
        <h2 className='palm-option-title'>ふりかえり</h2>
        <ul>
          {answers.map((answer, i) => (
            <li key={i} className={answer.correct ? 'is-correct' : 'is-wrong'}>
              <p className={`palm-review-judge ${answer.correct ? 'is-correct' : 'is-wrong'}`}>
                Q{i + 1} {answer.correct ? '正解' : '不正解'}
              </p>
              <p>{answer.question.text}</p>
              {!answer.correct && (
                <p className='palm-review-chosen'>あなたの答え: {answer.question.choices[answer.chosen]?.label}</p>
              )}
              <p className='palm-review-answer'>
                答え: {answer.question.choices.find((choice) => choice.correct)?.label}
              </p>
              <HorizontalBandMap shops={SHOPS} marked={answer.question.shops} />
            </li>
          ))}
        </ul>
      </section>
      <button type='button' className='palm-primary' onClick={onRetry}>
        もう一度
      </button>
      <button type='button' className='palm-text-button' onClick={onTop}>
        タイトルへ
      </button>
    </div>
  );
};

const Palm = () => {
  const [screen, setScreen] = useState<Screen>({ name: 'start' });
  // 問題を作り直すたびに PalmPlay をマウントし直すためのキー
  const [round, setRound] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'パルム散歩クイズ';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const start = () => {
    setRound(round + 1);
    setScreen({ name: 'play', questions: makeQuestions(SHOPS, Math.random) });
  };

  return (
    <main className='palm-page'>
      <h1 className='palm-title'>パルム散歩クイズ</h1>
      {screen.name === 'start' && <PalmStart onStart={start} />}
      {screen.name === 'play' && (
        <PalmPlay
          key={round}
          questions={screen.questions}
          onFinish={(answers) => setScreen({ name: 'result', answers })}
          onQuit={() => setScreen({ name: 'start' })}
        />
      )}
      {screen.name === 'result' && (
        <PalmResult answers={screen.answers} onRetry={start} onTop={() => setScreen({ name: 'start' })} />
      )}
    </main>
  );
};

export default Palm;
