SET XACT_ABORT ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

-- Source: QA_Form_Questions.xlsx, sheet "Form Questions", supplied 25 August 2026.
-- The source's "week N" labels are normalised to the application keys
-- week_1 through week_6. The readable week and theme remain snapshottable.
DECLARE @questions TABLE (
    source_row int NOT NULL,
    question_id uniqueidentifier NOT NULL,
    version_id uniqueidentifier NOT NULL,
    activity_key nvarchar(80) NOT NULL,
    question_key nvarchar(120) NOT NULL,
    display_order int NOT NULL,
    question_tag nvarchar(80) NOT NULL,
    theme_or_week nvarchar(200) NOT NULL,
    question_text nvarchar(1000) NOT NULL,
    guidance nvarchar(2000) NULL,
    is_required bit NOT NULL,
    allows_not_applicable bit NOT NULL,
    source_status nvarchar(20) NOT NULL
);

INSERT INTO @questions (
    source_row, question_id, version_id, activity_key, question_key,
    display_order, question_tag, theme_or_week, question_text, guidance,
    is_required, allows_not_applicable, source_status
) VALUES
(2, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000001'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000001'), N'lesson_visit', N'qa_form_20260825_001', 10, N'week_1', N'Week 1: Right Start', N'Tutor creates a welcoming environment.', N'Are learners welcomed into the space, acknowledged and valued, for example through learning names, greetings and positive noticing?', 1, 0, N'active'),
(3, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000002'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000002'), N'lesson_visit', N'qa_form_20260825_002', 20, N'week_1', N'Week 1: Right Start', N'Professional expectations are embedded and challenged constructively.', N'Consider classroom behaviours and how expectations are reinforced.', 1, 0, N'active'),
(4, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000003'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000003'), N'lesson_visit', N'qa_form_20260825_003', 30, N'week_1', N'Week 1: Right Start', N'Do-now activities support learner interaction.', NULL, 1, 0, N'active'),
(5, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000004'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000004'), N'lesson_visit', N'qa_form_20260825_004', 40, N'week_1', N'Week 1: Right Start', N'Learners understand their study programme.', NULL, 1, 0, N'active'),
(6, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000005'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000005'), N'lesson_visit', N'qa_form_20260825_005', 50, N'week_1', N'Week 1: Right Start', N'Every Learner Known is being established.', N'Look for evidence that connections with learners are being made.', 1, 0, N'active'),
(7, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000006'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000006'), N'lesson_visit', N'qa_form_20260825_006', 60, N'week_1', N'Week 1: Right Start', N'The Learner Group Profile (LGP) is being used.', NULL, 1, 0, N'active'),
(8, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000007'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000007'), N'lesson_visit', N'qa_form_20260825_007', 70, N'week_1', N'Week 1: Right Start', N'A positive, encouraging and supportive environment has been created.', NULL, 1, 0, N'active'),
(9, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000008'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000008'), N'digital_learning_walk', N'qa_form_20260825_008', 10, N'week_1', N'Week 1: Right Start', N'The VLE is set up with core course information.', NULL, 1, 0, N'active'),
(10, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000009'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000009'), N'digital_learning_walk', N'qa_form_20260825_009', 20, N'week_1', N'Week 1: Right Start', N'Clear communication channels have been established with learners.', NULL, 1, 0, N'active'),
(11, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000010'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000010'), N'digital_learning_walk', N'qa_form_20260825_010', 30, N'week_1', N'Week 1: Right Start', N'The VIA has been completed effectively.', N'Look for an accurate assessment of learners'' starting points.', 1, 0, N'active'),
(12, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000011'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000011'), N'digital_learning_walk', N'qa_form_20260825_011', 40, N'week_1', N'Week 1: Right Start', N'Core documents are complete.', NULL, 1, 0, N'active'),
(13, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000012'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000012'), N'digital_learning_walk', N'qa_form_20260825_012', 50, N'week_1', N'Week 1: Right Start', N'A curriculum map is available to learners.', NULL, 1, 0, N'active'),
(14, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000013'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000013'), N'digital_learning_walk', N'qa_form_20260825_013', 60, N'week_1', N'Week 1: Right Start', N'A learner handbook is available.', NULL, 1, 0, N'active'),
(15, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000014'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000014'), N'digital_learning_walk', N'qa_form_20260825_014', 70, N'week_1', N'Week 1: Right Start', N'Ambitious end points are defined in core documents.', NULL, 1, 0, N'active'),
(16, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000015'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000015'), N'digital_learning_walk', N'qa_form_20260825_015', 80, N'week_1', N'Week 1: Right Start', N'The markbook is set up and includes evidence of starting points.', NULL, 1, 0, N'active'),
(17, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000016'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000016'), N'stop_and_ask', N'qa_form_20260825_016', 10, N'week_1', N'Week 1: Right Start', N'Is your tutor aware of any support needs you have?', NULL, 1, 0, N'active'),
(18, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000017'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000017'), N'stop_and_ask', N'qa_form_20260825_017', 20, N'week_1', N'Week 1: Right Start', N'Are your support needs being met?', NULL, 1, 0, N'active'),
(19, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000018'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000018'), N'stop_and_ask', N'qa_form_20260825_018', 30, N'week_1', N'Week 1: Right Start', N'Are you being supported in a way that will help you achieve?', NULL, 1, 0, N'active'),
(20, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000019'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000019'), N'stop_and_ask', N'qa_form_20260825_019', 40, N'week_1', N'Week 1: Right Start', N'Do you know who your tutors are?', NULL, 1, 0, N'active'),
(21, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000020'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000020'), N'stop_and_ask', N'qa_form_20260825_020', 50, N'week_1', N'Week 1: Right Start', N'Do you know your timetable?', NULL, 1, 0, N'active'),
(22, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000021'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000021'), N'stop_and_ask', N'qa_form_20260825_021', 60, N'week_1', N'Week 1: Right Start', N'Do you know how to use the college app?', NULL, 1, 0, N'active'),
(23, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000022'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000022'), N'stop_and_ask', N'qa_form_20260825_022', 70, N'week_2', N'Week 2: Level 1', N'Is your tutor aware of any support needs you have?', NULL, 1, 0, N'active'),
(24, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000023'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000023'), N'stop_and_ask', N'qa_form_20260825_023', 80, N'week_2', N'Week 2: Level 1', N'Are your support needs being met?', NULL, 1, 0, N'active'),
(25, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000024'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000024'), N'stop_and_ask', N'qa_form_20260825_024', 90, N'week_2', N'Week 2: Level 1', N'Are you being supported in a way that will help you achieve?', NULL, 1, 0, N'active'),
(26, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000025'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000025'), N'stop_and_ask', N'qa_form_20260825_025', 100, N'week_2', N'Week 2: Level 1', N'Do you know who your tutors are?', NULL, 1, 0, N'active'),
(27, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000026'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000026'), N'stop_and_ask', N'qa_form_20260825_026', 110, N'week_2', N'Week 2: Level 1', N'Do you know your timetable?', NULL, 1, 0, N'active'),
(28, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000027'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000027'), N'stop_and_ask', N'qa_form_20260825_027', 120, N'week_2', N'Week 2: Level 1', N'Do you know how to use the college app?', NULL, 1, 0, N'active'),
(29, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000028'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000028'), N'student_voice', N'qa_form_20260825_028', 10, N'week_1', N'Week 1: Right Start', N'What are you going to be doing on your course?', NULL, 1, 0, N'active'),
(30, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000029'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000029'), N'student_voice', N'qa_form_20260825_029', 20, N'week_1', N'Week 1: Right Start', N'How will you be assessed on your course?', N'Ask about assessment methods and expectations.', 1, 0, N'active'),
(31, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000030'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000030'), N'student_voice', N'qa_form_20260825_030', 30, N'week_1', N'Week 1: Right Start', N'What is your intended destination or end point, and how will your course help you get there?', N'Explore the learner''s progression goal and understanding of the course''s purpose.', 1, 0, N'active'),
(32, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000031'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000031'), N'student_voice', N'qa_form_20260825_031', 40, N'week_1', N'Week 1: Right Start', N'How and when will you work with employers or industry experts?', NULL, 1, 0, N'active'),
(33, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000032'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000032'), N'student_voice', N'qa_form_20260825_032', 50, N'week_1', N'Week 1: Right Start', N'Are your tutors aware of your needs?', NULL, 1, 0, N'active'),
(34, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000033'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000033'), N'student_voice', N'qa_form_20260825_033', 60, N'week_1', N'Week 1: Right Start', N'Are your needs being met, and are you being supported in a way that helps you?', NULL, 1, 0, N'active'),
(35, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000034'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000034'), N'student_voice', N'qa_form_20260825_034', 70, N'week_1', N'Week 1: Right Start', N'Do you feel that your tutor has taken the time to get to know you?', NULL, 1, 0, N'active'),
(36, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000035'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000035'), N'student_voice', N'qa_form_20260825_035', 80, N'week_1', N'Week 1: Right Start', N'Has your tutor taken time to find out what you already know so that you can build on your knowledge?', NULL, 1, 0, N'active'),
(37, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000036'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000036'), N'student_voice', N'qa_form_20260825_036', 90, N'week_1', N'Week 1: Right Start', N'Have your lessons been interesting and enjoyable? Why?', NULL, 1, 0, N'active'),
(38, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000037'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000037'), N'student_voice', N'qa_form_20260825_037', 100, N'week_1', N'Week 1: Right Start', N'Have you learnt something new?', NULL, 1, 0, N'active'),
(39, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000038'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000038'), N'student_voice', N'qa_form_20260825_038', 110, N'week_1', N'Week 1: Right Start', N'What have you enjoyed most so far?', NULL, 1, 0, N'active'),
(40, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000039'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000039'), N'student_voice', N'qa_form_20260825_039', 120, N'week_1', N'Week 1: Right Start', N'How will your tutors communicate with you?', NULL, 1, 0, N'active'),
(41, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000040'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000040'), N'student_voice', N'qa_form_20260825_040', 130, N'week_2', N'Week 2: Level 1', N'What are you going to be doing on your course?', NULL, 1, 0, N'active'),
(42, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000041'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000041'), N'student_voice', N'qa_form_20260825_041', 140, N'week_2', N'Week 2: Level 1', N'How will you be assessed on your course?', N'Ask about assessment methods and expectations.', 1, 0, N'active'),
(43, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000042'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000042'), N'student_voice', N'qa_form_20260825_042', 150, N'week_2', N'Week 2: Level 1', N'What is your intended destination or end point, and how will your course help you get there?', N'Explore the learner''s progression goal and understanding of the course''s purpose.', 1, 0, N'active'),
(44, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000043'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000043'), N'student_voice', N'qa_form_20260825_043', 160, N'week_2', N'Week 2: Level 1', N'How and when will you work with employers or industry experts?', NULL, 1, 0, N'active'),
(45, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000044'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000044'), N'student_voice', N'qa_form_20260825_044', 170, N'week_2', N'Week 2: Level 1', N'Are your tutors aware of your needs?', NULL, 1, 0, N'active'),
(46, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000045'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000045'), N'student_voice', N'qa_form_20260825_045', 180, N'week_2', N'Week 2: Level 1', N'Are your needs being met, and are you being supported in a way that helps you?', NULL, 1, 0, N'active'),
(47, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000046'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000046'), N'student_voice', N'qa_form_20260825_046', 190, N'week_2', N'Week 2: Level 1', N'Do you feel that your tutor has taken the time to get to know you?', NULL, 1, 0, N'active'),
(48, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000047'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000047'), N'student_voice', N'qa_form_20260825_047', 200, N'week_2', N'Week 2: Level 1', N'Has your tutor taken time to find out what you already know so that you can build on your knowledge?', NULL, 1, 0, N'active'),
(49, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000048'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000048'), N'student_voice', N'qa_form_20260825_048', 210, N'week_2', N'Week 2: Level 1', N'Have your lessons been interesting and enjoyable? Why?', NULL, 1, 0, N'active'),
(50, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000049'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000049'), N'student_voice', N'qa_form_20260825_049', 220, N'week_2', N'Week 2: Level 1', N'Have you learnt something new?', NULL, 1, 0, N'active'),
(51, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000050'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000050'), N'student_voice', N'qa_form_20260825_050', 230, N'week_2', N'Week 2: Level 1', N'What have you enjoyed most so far?', NULL, 1, 0, N'active'),
(52, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000051'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000051'), N'student_voice', N'qa_form_20260825_051', 240, N'week_2', N'Week 2: Level 1', N'How will your tutors communicate with you?', NULL, 1, 0, N'active'),
(53, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000052'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000052'), N'work_scrutiny', N'qa_form_20260825_052', 10, N'week_1', N'Week 1: Right Start', N'An effective VIA has been completed.', NULL, 1, 0, N'active'),
(54, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000053'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000053'), N'work_scrutiny', N'qa_form_20260825_053', 20, N'week_1', N'Week 1: Right Start', N'Informative and actionable VIA feedback has been provided.', NULL, 1, 0, N'active'),
(55, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000054'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000054'), N'work_scrutiny', N'qa_form_20260825_054', 30, N'week_1', N'Week 1: Right Start', N'WWW and EBI practice is used.', NULL, 1, 0, N'active'),
(56, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000055'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000055'), N'walk_around', N'qa_form_20260825_055', 10, N'week_1', N'Week 1: Right Start', N'The lesson started on time.', NULL, 1, 0, N'active'),
(57, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000056'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000056'), N'walk_around', N'qa_form_20260825_056', 20, N'week_1', N'Week 1: Right Start', N'The tutor is welcoming learners.', NULL, 1, 0, N'active'),
(58, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000057'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000057'), N'walk_around', N'qa_form_20260825_057', 30, N'week_1', N'Week 1: Right Start', N'Attendance is accurately reflected against the register.', NULL, 1, 0, N'active'),
(59, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000058'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000058'), N'walk_around', N'qa_form_20260825_058', 40, N'week_1', N'Week 1: Right Start', N'The learning environment is appropriate.', NULL, 1, 0, N'active'),
(60, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000059'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000059'), N'desk_review', N'qa_form_20260825_059', 10, N'week_1', N'Week 1: Right Start', N'Attendance concerns have an effective intervention logged.', N'Use N/A where this desk review is being used for a different activity.', 1, 1, N'active'),
(61, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000060'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000060'), N'desk_review', N'qa_form_20260825_060', 20, N'week_1', N'Week 1: Right Start', N'Targets for learners with high needs align to their identified need or EHCP outcome.', N'Use N/A where this desk review is being used for a different activity.', 1, 1, N'active'),
(62, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000061'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000061'), N'desk_review', N'qa_form_20260825_061', 30, N'week_1', N'Week 1: Right Start', N'The volume of learners being referred for diagnostic assessment is appropriate and understood.', N'Use N/A where this desk review is being used for a different activity.', 1, 1, N'active'),
(63, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000062'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000062'), N'desk_review', N'qa_form_20260825_062', 40, N'week_1', N'Week 1: Right Start', N'Learner timetables are accurate and correct.', N'Use N/A where this desk review is being used for a different activity.', 1, 1, N'active'),
(64, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000063'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000063'), N'lesson_visit', N'qa_form_20260825_063', 80, N'week_2', N'Week 2: Level 1', N'Lesson activities are challenging and engaging.', N'Learners participate in structured activities and attempt tasks rather than opting out, even if confidence is still developing.', 1, 0, N'active'),
(65, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000064'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000064'), N'lesson_visit', N'qa_form_20260825_064', 90, N'week_2', N'Week 2: Level 1', N'Learners are beginning to work independently.', N'Learners complete parts of tasks without constant tutor direction, supported by clear scaffolds.', 1, 0, N'active'),
(66, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000065'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000065'), N'lesson_visit', N'qa_form_20260825_065', 100, N'week_2', N'Week 2: Level 1', N'Learners respond positively to cues that they belong.', N'Look for smiles, relaxed posture and increased willingness to contribute when learners are noticed and valued.', 1, 0, N'active'),
(67, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000066'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000066'), N'lesson_visit', N'qa_form_20260825_066', 110, N'week_2', N'Week 2: Level 1', N'High expectations are communicated and effectively challenged.', NULL, 1, 0, N'active'),
(68, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000067'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000067'), N'lesson_visit', N'qa_form_20260825_067', 120, N'week_2', N'Week 2: Level 1', N'Learners understand the relevance of the learning.', N'Look for links to industry, jobs and careers.', 1, 0, N'active'),
(69, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000068'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000068'), N'lesson_visit', N'qa_form_20260825_068', 130, N'week_2', N'Week 2: Level 1', N'Information is presented clearly and logically.', NULL, 1, 0, N'active'),
(70, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000069'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000069'), N'lesson_visit', N'qa_form_20260825_069', 140, N'week_2', N'Week 2: Level 1', N'Checks of starting points and understanding identify gaps and lead to appropriate adjustments.', NULL, 1, 0, N'active'),
(71, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000070'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000070'), N'lesson_visit', N'qa_form_20260825_070', 150, N'week_2', N'Week 2: Level 1', N'The wider study programme is evident.', N'English and mathematics are embedded, discussed or included to support progress.', 1, 0, N'active'),
(72, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000071'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000071'), N'lesson_visit', N'qa_form_20260825_071', 160, N'week_2', N'Week 2: Level 1', N'All learners can access and participate in the learning.', N'Appropriate adjustments are made for learners with SEND so that they can participate fully.', 1, 0, N'active'),
(73, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000072'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000072'), N'digital_learning_walk', N'qa_form_20260825_072', 90, N'week_2', N'Week 2: Level 1', N'The assessment plan shows a logical sequence and builds knowledge over time.', NULL, 1, 0, N'active'),
(74, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000073'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000073'), N'digital_learning_walk', N'qa_form_20260825_073', 100, N'week_2', N'Week 2: Level 1', N'Clear and ambitious targets are linked to learner outcomes and end points.', NULL, 1, 0, N'active'),
(75, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000074'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000074'), N'digital_learning_walk', N'qa_form_20260825_074', 110, N'week_2', N'Week 2: Level 1', N'The planned curriculum is ambitious.', N'Review the scheme of work and related curriculum planning.', 1, 0, N'active'),
(76, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000075'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000075'), N'digital_learning_walk', N'qa_form_20260825_075', 120, N'week_2', N'Week 2: Level 1', N'VIA outcomes inform ambitious learner targets.', NULL, 1, 0, N'active'),
(77, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000076'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000076'), N'lesson_visit', N'qa_form_20260825_076', 170, N'week_3', N'Week 3: Skills', N'Learning reflects expected industry practice and current employer needs.', NULL, 1, 0, N'active'),
(78, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000077'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000077'), N'lesson_visit', N'qa_form_20260825_077', 180, N'week_3', N'Week 3: Skills', N'Learners demonstrate the professional behaviours and attitudes required for their vocational pathway or profession.', NULL, 1, 0, N'active'),
(79, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000078'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000078'), N'lesson_visit', N'qa_form_20260825_078', 190, N'week_3', N'Week 3: Skills', N'Relevant employability skills are embedded in lesson activities.', NULL, 1, 0, N'active'),
(80, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000079'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000079'), N'lesson_visit', N'qa_form_20260825_079', 200, N'week_3', N'Week 3: Skills', N'Learning is contextualised to work opportunities relevant to learners'' progression routes.', NULL, 1, 0, N'active'),
(81, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000080'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000080'), N'lesson_visit', N'qa_form_20260825_080', 210, N'week_3', N'Week 3: Skills', N'Tasks and activities link to a clear end point or goal.', NULL, 1, 0, N'active'),
(82, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000081'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000081'), N'lesson_visit', N'qa_form_20260825_081', 220, N'week_3', N'Week 3: Skills', N'Assessment identifies learners who are struggling and leads to adaptations that close knowledge gaps.', NULL, 1, 0, N'active'),
(83, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000082'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000082'), N'lesson_visit', N'qa_form_20260825_082', 230, N'week_3', N'Week 3: Skills', N'Vocabulary is relevant to the industry.', NULL, 1, 0, N'active'),
(84, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000083'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000083'), N'lesson_visit', N'qa_form_20260825_083', 240, N'week_3', N'Week 3: Skills', N'Lesson tasks and activities develop relevant industry-ready skills, such as communication.', NULL, 1, 0, N'active'),
(85, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000084'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000084'), N'lesson_visit', N'qa_form_20260825_084', 250, N'week_3', N'Week 3: Skills', N'Learners apply and practise skills as they would in the workplace.', NULL, 1, 0, N'active'),
(86, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000085'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000085'), N'digital_learning_walk', N'qa_form_20260825_085', 130, N'week_3', N'Week 3: Skills', N'Assessment plans and curriculum maps integrate employers and industry into planning, delivery and assessment.', NULL, 1, 0, N'active'),
(87, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000086'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000086'), N'digital_learning_walk', N'qa_form_20260825_086', 140, N'week_3', N'Week 3: Skills', N'Learner feedback links to relevant industry knowledge and skills.', NULL, 1, 0, N'active'),
(88, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000087'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000087'), N'stop_and_ask', N'qa_form_20260825_087', 130, N'week_3', N'Week 3: Skills', N'Are employers or industry experts going to be involved in your learning or lessons?', NULL, 1, 0, N'active'),
(89, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000088'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000088'), N'stop_and_ask', N'qa_form_20260825_088', 140, N'week_3', N'Week 3: Skills', N'Are employers or industry experts going to be involved in your assessments?', NULL, 1, 0, N'active'),
(90, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000089'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000089'), N'stop_and_ask', N'qa_form_20260825_089', 150, N'week_3', N'Week 3: Skills', N'Are your tutors helping you to develop the skills needed for your future career?', NULL, 1, 0, N'active'),
(91, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000090'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000090'), N'stop_and_ask', N'qa_form_20260825_090', 160, N'week_4', N'Week 4: Personal and Professional Development', N'Have you been provided with information about healthy relationships?', NULL, 1, 0, N'active'),
(92, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000091'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000091'), N'stop_and_ask', N'qa_form_20260825_091', 170, N'week_4', N'Week 4: Personal and Professional Development', N'Have you taken part in activities relating to mental and physical health?', NULL, 1, 0, N'active'),
(93, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000092'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000092'), N'stop_and_ask', N'qa_form_20260825_092', 180, N'week_4', N'Week 4: Personal and Professional Development', N'Have you discussed how to keep yourself safe from radicalisation, extreme views and online harm?', NULL, 1, 0, N'active'),
(94, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000093'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000093'), N'stop_and_ask', N'qa_form_20260825_093', 190, N'week_4', N'Week 4: Personal and Professional Development', N'Have you had an opportunity to develop your understanding of British values and protected characteristics?', NULL, 1, 0, N'active'),
(95, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000094'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000094'), N'lesson_visit', N'qa_form_20260825_094', 260, N'week_5', N'Week 5: Assessment and Feedback', N'Learners receive feedback during the lesson that helps them to improve.', NULL, 1, 0, N'active'),
(96, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000095'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000095'), N'student_voice', N'qa_form_20260825_095', 250, N'week_5', N'Week 5: Assessment and Feedback', N'Do you know what you are doing well and what you need to improve?', N'Ask the learner what they need to revise or develop.', 1, 0, N'active'),
(97, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000096'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000096'), N'stop_and_ask', N'qa_form_20260825_096', 200, N'week_5', N'Week 5: Assessment and Feedback', N'Has your tutor provided feedback that has helped you to improve or develop?', NULL, 1, 0, N'active'),
(98, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000097'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000097'), N'stop_and_ask', N'qa_form_20260825_097', 210, N'week_5', N'Week 5: Assessment and Feedback', N'Have you learnt something new or gained new knowledge?', NULL, 1, 0, N'active'),
(99, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000098'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000098'), N'stop_and_ask', N'qa_form_20260825_098', 220, N'week_5', N'Week 5: Assessment and Feedback', N'Have you made progress?', NULL, 1, 0, N'active'),
(100, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000099'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000099'), N'lesson_visit', N'qa_form_20260825_099', 270, N'week_6', N'Week 6: English and Maths', N'Learning is contextualised using engaging points of reference that reflect learner destinations.', NULL, 1, 0, N'active'),
(101, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000100'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000100'), N'lesson_visit', N'qa_form_20260825_100', 280, N'week_6', N'Week 6: English and Maths', N'Learners can identify their strengths and areas for improvement and know what they need to revise.', NULL, 1, 0, N'active'),
(102, CONVERT(uniqueidentifier, '74000000-0000-0000-0000-000000000101'), CONVERT(uniqueidentifier, '75000000-0000-0000-0000-000000000101'), N'lesson_visit', N'qa_form_20260825_101', 290, N'week_6', N'Week 6: English and Maths', N'Teachers develop learners'' English, mathematics and digital skills in vocational lessons.', N'Look for appropriate opportunities being identified and acted upon.', 1, 0, N'active');

IF (SELECT COUNT(*) FROM @questions) <> 101
    THROW 51000, 'QA_Form_Questions.xlsx must seed exactly 101 questions.', 1;

IF EXISTS (
    SELECT 1 FROM @questions source
    WHERE NOT EXISTS (SELECT 1 FROM qa.activity_types activity WHERE activity.activity_key = source.activity_key)
)
    THROW 51000, 'A required fixed QA activity type is missing.', 1;

INSERT INTO qa.questions (id, activity_type_id, question_key, default_display_order)
SELECT source.question_id, activity.id, source.question_key, source.display_order
FROM @questions source
JOIN qa.activity_types activity ON activity.activity_key = source.activity_key
WHERE NOT EXISTS (
    SELECT 1 FROM qa.questions existing
    WHERE existing.id = source.question_id OR existing.question_key = source.question_key
);

INSERT INTO qa.question_versions (
    id, question_id, version_number, theme_or_week, question_text, guidance,
    is_required, allows_not_applicable, comment_required_at_expected,
    is_active, source_status, question_tag
)
SELECT source.version_id, question.id, 1, source.theme_or_week, source.question_text, source.guidance,
       source.is_required, source.allows_not_applicable, 0,
       CASE WHEN source.source_status = N'active' THEN 1 ELSE 0 END,
       source.source_status, source.question_tag
FROM @questions source
JOIN qa.questions question ON question.question_key = source.question_key
WHERE NOT EXISTS (
    SELECT 1 FROM qa.question_versions existing
    WHERE existing.id = source.version_id
       OR existing.question_id = question.id AND existing.version_number = 1
);

INSERT INTO qa.activity_template_questions (activity_template_id, question_id, display_order)
SELECT template.id, question.id, source.display_order
FROM @questions source
JOIN qa.questions question ON question.question_key = source.question_key
JOIN qa.activity_types activity ON activity.id = question.activity_type_id
JOIN qa.activity_templates template
  ON template.activity_type_id = activity.id
 AND template.archived_at IS NULL
 AND template.template_key LIKE N'qa_%_initial'
WHERE NOT EXISTS (
    SELECT 1 FROM qa.activity_template_questions existing
    WHERE existing.activity_template_id = template.id
      AND existing.question_id = question.id
);

COMMIT TRANSACTION;
GO
