// MCP tools of the Mock interview: start it, place its Cards one at a time, and end it.
import { z } from "zod";
import { mockDurationLimits } from "@prepare-to-interview/shared";
import type { Interviewer } from "../interviewer/interviewer.ts";
import type { MockRunner } from "../interviewer/mock-runner.ts";
import { defineTool, type ToolDefinition } from "./tool.ts";
// Called when the tool list is built, after tools.ts has finished loading.
import { practiceCardInput, toPracticeQuestion } from "./tools.ts";

export function mockTools({ mock, interviewer }: { mock: MockRunner; interviewer: Interviewer }): ToolDefinition[] {
  return [
    defineTool({
      name: "start_mock_interview",
      title: "Start a Mock interview",
      description:
        "Start a Mock interview once the Candidate chose its duration and focus (Topics of the active Preparation target, weak spots, or the whole target). The app shows the interview and its timer on the Canvas and ends it at the deadline. Returns the interview skill: follow it from now on.",
      input: z.strictObject({
        duration_minutes: z.number().int().min(mockDurationLimits.min).max(mockDurationLimits.max).default(30),
        focus: z
          .strictObject({
            topics: z.array(z.string().trim().min(1).max(120)).max(10).optional().describe("Topic names from get_progress."),
            weak_spots: z.boolean().optional().describe("Focus on the Candidate's weak Topics."),
          })
          .optional()
          .describe("Omit for the whole active Preparation target."),
      }),
      output: z.strictObject({
        mock_interview_id: z.string(),
        minutes_left: z.number(),
        skill: z.string().nullable(),
      }),
      fixHint: 'Pass {"duration_minutes": 30, "focus": {"topics": ["<Topic from get_progress>"], "weak_spots": false}}.',
      run: (input) => {
        const { node, activity } = mock.start({
          durationMinutes: input.duration_minutes,
          focus: { topics: input.focus?.topics ?? [], weakSpots: input.focus?.weak_spots ?? false },
        });
        return {
          mock_interview_id: node.id,
          minutes_left: input.duration_minutes,
          skill: activity.started ? (interviewer.skillForStartedActivity({ id: activity.id, kind: "mock_interview" }) ?? null) : null,
        };
      },
      summarize: (o) =>
        `Started the Mock interview (${o.mock_interview_id}), ${o.minutes_left} minutes. Place the first Card with next_mock_question.${o.skill ? ` Follow this skill:\n\n${o.skill}` : ""}`,
    }),

    defineTool({
      name: "next_mock_question",
      title: "Place the next Mock interview Card",
      description:
        "Place the next Card of the running Mock interview, one at a time: only after the Candidate answered the previous one. Take a Question from get_progress by question_id or compose one (open Questions need reference_answer). For a follow-up, pass follow_up_of with the answered Card's card_id and quote, a short piece of that answer copied verbatim; the Card shows the quote and links to its parent. Grades stay hidden until the mock ends.",
      input: z.strictObject({
        question: practiceCardInput,
        follow_up_of: z.string().min(1).optional().describe("card_id of the answered Card this follow-up probes."),
        quote: z.string().trim().min(1).max(500).optional().describe("Verbatim piece of the parent Card's answer."),
      }),
      output: z.strictObject({ card_id: z.string(), question_number: z.number(), minutes_left: z.number() }),
      fixHint:
        'Pass {"question": {"question_id": "<from get_progress>"}} or {"question": {"topic": "...", "prompt": "...", "type": "open", "reference_answer": "..."}}; for a follow-up add "follow_up_of": "<card_id>", "quote": "<verbatim piece of the answer>".',
      run: (input) => {
        const placed = mock.ask({
          question: toPracticeQuestion(input.question),
          ...(input.follow_up_of !== undefined && { followUpOf: input.follow_up_of }),
          ...(input.quote !== undefined && { quote: input.quote }),
        });
        return { card_id: placed.cardId, question_number: placed.questionNumber, minutes_left: placed.minutesLeft };
      },
      summarize: (o) =>
        `Placed question ${o.question_number} on the Canvas (${o.card_id}); ${o.minutes_left} minutes left. Wait for the Candidate's answer: it arrives in your next turn.`,
    }),

    defineTool({
      name: "finish_mock_interview",
      title: "End the Mock interview",
      description:
        "End the running Mock interview when its focus is covered, the time is nearly up, or the Candidate asks to stop. The app sends every answer to the Grader and tells you the results; the open Card's saved draft counts as its answer.",
      input: z.strictObject({}),
      output: z.strictObject({ mock_interview_id: z.string(), questions: z.number() }),
      fixHint: "Call finish_mock_interview with no arguments while a Mock interview runs.",
      run: () => {
        const end = mock.finish("interviewer");
        return { mock_interview_id: end.setId, questions: end.questionCount };
      },
      summarize: (o) =>
        `Ended the Mock interview after ${o.questions} questions. The Grader grades the answers; grades appear on the Cards and you receive the results. Tell the Candidate in one sentence.`,
    }),
  ];
}
