SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

DECLARE @importKey nvarchar(150) = N'curriculum_staff_2026_07';
DECLARE @isFirstImport bit = CASE WHEN EXISTS (
    SELECT 1 FROM ops.data_import_runs WHERE import_key = @importKey
) THEN 0 ELSE 1 END;
DECLARE @adminStaffId uniqueidentifier = (
    SELECT id FROM people.staff WHERE email = N'harryjbentley@outlook.com' AND archived_at IS NULL
);
DECLARE @adminAccountId uniqueidentifier = (
    SELECT ua.id
    FROM auth.user_accounts ua
    WHERE ua.staff_id = @adminStaffId AND ua.archived_at IS NULL
);

IF @adminStaffId IS NULL OR @adminAccountId IS NULL
BEGIN
    THROW 51000, 'The protected Harry Bentley administrator account must exist before staff onboarding.', 1;
END;

DECLARE @source TABLE (
    faculty_codes nvarchar(100) NOT NULL,
    team_codes nvarchar(100) NULL,
    external_id nvarchar(50) NOT NULL,
    first_name nvarchar(100) NOT NULL,
    last_name nvarchar(100) NOT NULL,
    display_name nvarchar(220) NOT NULL
);

INSERT INTO @source (faculty_codes, team_codes, external_id, first_name, last_name, display_name)
VALUES
    (N'WBL-CUCB', NULL, N'ST5636', N'Peter', N'Andrews', N'Peter Andrews'),
    (N'WBL-CUCB', NULL, N'AD3666', N'Belinda', N'Corrigan', N'Belinda Corrigan'),
    (N'WBL-CUCB', NULL, N'AD5765', N'Andrew', N'Crompton', N'Andrew Crompton'),
    (N'WBL-CUCB', NULL, N'ST4306', N'David', N'Cunliffe', N'David Cunliffe'),
    (N'WBL-CUCB', NULL, N'AD5496', N'William', N'Hoggard', N'William Hoggard'),
    (N'WBL-CUCB', NULL, N'AD5607', N'Alison', N'Simpson', N'Alison Simpson'),
    (N'WBL-CUCB', NULL, N'AD5329', N'Alexander', N'Thompson', N'Alexander Thompson'),
    (N'WBL-CUCB', NULL, N'ST4590', N'Peter', N'Woodruff', N'Peter Woodruff'),
    (N'WBL-CUCB', NULL, N'ST4713', N'Geoffrey', N'Wright', N'Geoffrey Wright'),
    (N'CUCB', N'CUCBBRK', N'AD5510', N'Joseph', N'Deakin', N'Joseph Deakin'),
    (N'CUCB', N'CUCBBRK', N'AD2193', N'Paul', N'Gorton', N'Paul Gorton'),
    (N'CUCB', N'CUCBBRK', N'AD5549', N'Robert', N'Guthrie', N'Robert Guthrie'),
    (N'CUCB', N'CUCBBRK', N'AD4927', N'Gary', N'Marshall', N'Gary Marshall'),
    (N'CUCB', N'CUCBBRK', N'AD5174', N'Sam', N'Taylor', N'Sam Taylor'),
    (N'CUCB', N'CUCBBRK', N'AD1915', N'Craig', N'Whiteley', N'Craig Whiteley'),
    (N'CUCB', N'CUCBCJ', N'AD5494', N'Nicholas', N'Kelliher', N'Nicholas Kelliher'),
    (N'CUCB', N'CUCBBRK; CUCBCJ', N'AD4842', N'Christopher', N'Partington', N'Christopher Partington'),
    (N'CUCB', N'CUCBCJ', N'AD5511', N'Robert', N'Collins', N'Robert Collins'),
    (N'CUCB', N'CUCBCJ', N'AD2237', N'Wayne', N'Davenport', N'Wayne Davenport'),
    (N'CUCB', N'CUCBCJ', N'AD3354', N'Richard', N'Ekin', N'Richard Ekin'),
    (N'CUCB', N'CUCBCJ', N'AD3717', N'Jeffrey', N'Houghton', N'Jeffrey Houghton'),
    (N'CUCB', N'CUCBCJ', N'AD5724', N'David', N'Keyzer', N'David Keyzer'),
    (N'CUCB', N'CUCBCJ', N'AD5508', N'Stephen', N'Lee', N'Stephen Lee'),
    (N'CUCB', N'CUCBCJ', N'AD4326', N'Stephen', N'McEvoy', N'Stephen McEvoy'),
    (N'CUCB', N'CUCBDSP', N'AD5626', N'David', N'Dalton', N'David Dalton'),
    (N'CUCB', N'CUCBDSP', N'AD4631', N'Clayton', N'Fluke', N'Clayton Fluke'),
    (N'CUCB', N'CUCBDSP', N'AD5536', N'Mohammed Samir', N'Khamisa', N'Mohammed Samir Khamisa'),
    (N'CUCB', N'CUCBDSP', N'AD4925', N'Darren', N'Maher', N'Darren Maher'),
    (N'CUCB', N'CUCBDSP', N'AD4654', N'Ryan', N'Maher', N'Ryan Maher'),
    (N'CUCB', N'CUCBELEC', N'AD5202', N'Sorwar', N'Alom', N'Sorwar Alom'),
    (N'CUCB', N'CUCBELEC', N'AD3271', N'Ian', N'Barrow', N'Ian Barrow'),
    (N'CUCB', N'CUCBELEC', N'AD5796', N'Paul', N'Brown', N'Paul Brown'),
    (N'CUCB', N'CUCBELEC', N'AD5509', N'Nicholas', N'Carvel', N'Nicholas Carvel'),
    (N'CUCB', N'CUCBELEC', N'AD5589', N'Alan', N'Faulkner', N'Alan Faulkner'),
    (N'CUCB', N'CUCBELEC', N'AD4461', N'Paul', N'Gale', N'Paul Gale'),
    (N'CUCB', N'CUCBELEC', N'AD5580', N'Ross', N'Howell', N'Ross Howell'),
    (N'CUCB', N'CUCBELEC', N'AD4933', N'Ian', N'Lancaster', N'Ian Lancaster'),
    (N'CUCB', N'CUCBELEC', N'AD5579', N'Linford', N'Miller', N'Linford Miller'),
    (N'CUCB', N'CUCBELEC', N'AD5683', N'Jordan', N'Pollitt-Smith', N'Jordan Pollitt-Smith'),
    (N'CUCB', N'CUCBELEC', N'AD5425', N'Daniel', N'Ross', N'Daniel Ross'),
    (N'CUCB', N'CUCBELEC', N'AD5528', N'Paul', N'Shannon', N'Paul Shannon'),
    (N'CUCB', N'CUCBELEC', N'AD5637', N'Sean', N'Woolfenden', N'Sean Woolfenden'),
    (N'CUCB', N'CUCBMV', N'AD5823', N'Robert', N'Czyzewski', N'Robert Czyzewski'),
    (N'CUCB', N'CUCBMV', N'AD3902', N'Kieran', N'Delaney', N'Kieran Delaney'),
    (N'CUCB', N'CUCBMV', N'AD4924', N'Stephen', N'Gannon', N'Stephen Gannon'),
    (N'CUCB', N'CUCBMV', N'AD5430', N'Chris', N'McDonnell', N'Chris McDonnell'),
    (N'CUCB', N'CUCBMV', N'AD4559', N'William', N'Mercer', N'William Mercer'),
    (N'CUCB', N'CUCBPLU', N'AD5751', N'Rowen', N'Agg', N'Rowen Agg'),
    (N'CUCB', N'CUCBPLU', N'AD3758', N'Graeme', N'Backhouse', N'Graeme Backhouse'),
    (N'CUCB', N'CUCBPLU', N'AD5168', N'Sean', N'Baines', N'Sean Baines'),
    (N'CUCB', N'CUCBPLU', N'AD3419', N'Russell', N'Basnett', N'Russell Basnett'),
    (N'CUCB', N'CUCBPLU', N'AD4227', N'Mike', N'Delaney', N'Mike Delaney'),
    (N'CUCB', N'CUCBPLU', N'AD5704', N'Barry', N'Hardman', N'Barry Hardman'),
    (N'CUCB', N'CUCBPLU', N'AD3873', N'Oliver', N'Heginbotham', N'Oliver Heginbotham'),
    (N'CUCB', N'CUCBPLU', N'AD5534', N'Craig', N'Robertshaw', N'Craig Robertshaw'),
    (N'CUCB', N'CUCBPLU', N'AD5639', N'Stephen', N'Seddon', N'Stephen Seddon'),
    (N'CUCP', N'CUCPSC', N'AD5828', N'Lianne', N'Dawson', N'Lianne Dawson'),
    (N'CUCP', NULL, N'AD5144', N'Jennifer', N'Hedley', N'Jennifer Hedley'),
    (N'CUCP', N'CUCPEY', N'AD4077', N'Leanne', N'Bailey', N'Leanne Bailey'),
    (N'CUCP', N'CUCPEY', N'AD4780', N'Frances', N'Bennett', N'Frances Bennett'),
    (N'CUCP', N'CUCPEY', N'AD4209', N'Christopher', N'Corr', N'Christopher Corr'),
    (N'CUCP', N'CUCPEY', N'AD3903', N'Gemma', N'Dunne', N'Gemma Dunne'),
    (N'CUCP', N'CUCPEY', N'AD3730', N'Katy', N'Griffiths', N'Katy Griffiths'),
    (N'CUCP', N'CUCPEY', N'AD5569', N'Zaneekh', N'Nisar', N'Zaneekh Nisar'),
    (N'CUCP', N'CUCPEY', N'AD4210', N'Faiza', N'Rasul', N'Faiza Rasul'),
    (N'CUCP', N'CUCPEY', N'AD3510', N'Roni', N'Ruwanza', N'Roni Ruwanza'),
    (N'CUCP', N'CUCPEY', N'AD1550', N'Joanne', N'Selby', N'Joanne Selby'),
    (N'CUCP', N'CUCPEY', N'AD2525', N'Nicola', N'Sergeant', N'Nicola Sergeant'),
    (N'CUCP', N'CUCPEY', N'AD4207', N'Samantha', N'Winchester', N'Samantha Winchester'),
    (N'CUCP', N'CUCPHSC', N'AD4752', N'Zahanara', N'Begum', N'Zahanara Begum'),
    (N'CUCP', N'CUCPHSC', N'AD5227', N'Julia', N'Douglas', N'Julia Douglas'),
    (N'CUCP', N'CUCPHSC', N'AD5439', N'Saimah', N'Jasmin', N'Saimah Jasmin'),
    (N'CUCP', N'CUCPHSC', N'AD5551', N'Louise', N'Kilkelly', N'Louise Kilkelly'),
    (N'CUCP', N'CUCPHSC', N'AD5309', N'Smaira', N'Kousar', N'Smaira Kousar'),
    (N'CUCP', N'CUCPHSC', N'AD4562', N'Tonicha', N'Lucas', N'Tonicha Lucas'),
    (N'CUCP', N'CUCPHSC', N'AD5531', N'Emma', N'Morgan', N'Emma Morgan'),
    (N'CUCP', N'CUCPHSC', N'AD5598', N'Daniel', N'Mullan', N'Daniel Mullan'),
    (N'CUCP', N'CUCPHSC', N'AD4035', N'Juwayriyah', N'Naseer', N'Juwayriyah Naseer'),
    (N'CUCP', N'CUCPHSC', N'AD5201', N'Liam', N'Pepperell', N'Liam Pepperell'),
    (N'CUCP', N'CUCPHSC', N'AD5829', N'Jaclyn', N'Smith', N'Jaclyn Smith'),
    (N'CUCP', N'CUCPHSC', N'AD5072', N'Julie', N'Taylor-Moore', N'Julie Taylor-Moore'),
    (N'CUCP', N'CUCPHSC', N'AD5806', N'Louise', N'Turnbull', N'Louise Turnbull'),
    (N'CUCP', N'CUCPSC', N'AD2583', N'Abdul-Redha', N'Attiah', N'Abdul-Redha Attiah'),
    (N'CUCP', N'CUCPSC', N'AD5305', N'Michael', N'Beswick', N'Michael Beswick'),
    (N'CUCP', N'CUCPSC', N'AD4711', N'Jordan', N'Booth', N'Jordan Booth'),
    (N'CUCP', N'CUCPSC', N'AD5570', N'Katie', N'Conlon', N'Katie Conlon'),
    (N'CUCP', N'CUCPSC', N'AD5763', N'Debra', N'Geoghegan', N'Debra Geoghegan'),
    (N'CUCP', N'CUCPSC', N'AD4596', N'Urfan', N'Kanval', N'Urfan Kanval'),
    (N'CUCP', N'CUCPSC', N'AD4678', N'Mudassar', N'Khaliq', N'Mudassar Khaliq'),
    (N'CUCP', N'CUCPSC', N'AD5330', N'Ghina', N'Merheb', N'Ghina Merheb'),
    (N'CUCP', N'CUCPSC', N'AD4943', N'Amber', N'Pasha', N'Amber Pasha'),
    (N'CUCP', N'CUCPSC', N'AD5577', N'Katie', N'Wilkinson', N'Katie Wilkinson'),
    (N'CUDC', N'CUDCCRE', N'AD4605', N'Emma', N'Blackburn', N'Emma Blackburn'),
    (N'CUDC', N'CUDCCRE', N'AD5135', N'Matthew', N'Bowles', N'Matthew Bowles'),
    (N'CUDC', N'CUDCCRE', N'AD4531', N'Paul', N'Burnett', N'Paul Burnett'),
    (N'CUDC', N'CUDCCRE', N'AD4095', N'Alison', N'Cropper', N'Alison Cropper'),
    (N'CUDC', N'CUDCCRE', N'AD5617', N'Lauren', N'Driscoll', N'Lauren Driscoll'),
    (N'CUDC', N'CUDCCRE', N'AD5798', N'Elliah', N'Farrell', N'Elliah Farrell'),
    (N'CUDC', N'CUDCCRE', N'AD5603', N'Ikponmwosa', N'Gaius-Obaseki', N'Ikponmwosa Gaius-Obaseki'),
    (N'CUDC', N'CUDCCRE', N'AD4863', N'Rose', N'Gill', N'Rose Gill'),
    (N'CUDC', N'CUDCCRE', N'AD5604', N'Simon', N'Gupta', N'Simon Gupta'),
    (N'CUDC', N'CUDCCRE', N'AD4741', N'Joseph', N'Hill', N'Joseph Hill'),
    (N'CUDC', N'CUDCCRE', N'AD3231', N'Shah Mohammed Soyful', N'Islam', N'Shah Mohammed Soyful Islam'),
    (N'CUDC', N'CUDCCRE', N'AD4811', N'Ric', N'Latham', N'Ric Latham'),
    (N'CUDC', N'CUDCCRE', N'AD5605', N'Emma', N'Matley', N'Emma Matley'),
    (N'CUDC', N'CUDCCRE', N'AD4879', N'Benjamin', N'McChrystal Plimmer', N'Benjamin McChrystal Plimmer'),
    (N'CUDC', N'CUDCCRE', N'AD3189', N'Jay', N'McCreary', N'Jay McCreary'),
    (N'CUDC', N'CUDCCRE', N'AD4836', N'Luke', N'McDaid Barraclough', N'Luke McDaid Barraclough'),
    (N'CUDC', N'CUDCCRE', N'AD4235', N'Johnstone', N'McGuckian', N'Johnstone McGuckian'),
    (N'CUDC', N'CUDCCRE', N'AD2482', N'Michelle', N'Naylor', N'Michelle Naylor'),
    (N'CUDC', N'CUDCCRE', N'AD5236', N'Kendal', N'Wright', N'Kendal Wright'),
    (N'CUDC', N'CUDCDIG', N'AD5609', N'Abdallah', N'Adnan', N'Abdallah Adnan'),
    (N'CUDC', N'CUDCDIG', N'AD5557', N'Muhammad', N'Ahmad', N'Muhammad Ahmad'),
    (N'CUDC', N'CUDCDIG', N'AD5629', N'Jamil', N'Ahmed', N'Jamil Ahmed'),
    (N'CUDC', N'CUDCDIG', N'AD5615', N'Anisah', N'Akhtar', N'Anisah Akhtar'),
    (N'CUDC', N'CUDCDIG', N'AD5362', N'William', N'Caffery', N'William Caffery'),
    (N'CUDC', N'CUDCDIG', N'AD4567', N'Aaron', N'Cocker-Swanick', N'Aaron Cocker-Swanick'),
    (N'CUDC', N'CUDCDIG', N'AD5611', N'Rabiul', N'Hasan', N'Rabiul Hasan'),
    (N'CUDC', N'CUDCDIG', N'AD4690', N'Travis', N'Hiner', N'Travis Hiner'),
    (N'CUDC', N'CUDCDIG', N'AD4916', N'Murtatha', N'Hussein', N'Murtatha Hussein'),
    (N'CUDC', N'CUDCDIG', N'AD2359', N'Denys', N'Lewis', N'Denys Lewis'),
    (N'CUDC', N'CUDCDIG', N'AD2598', N'Wayne', N'Styles', N'Wayne Styles'),
    (N'CUDC; CUPA', NULL, N'AD1453', N'Joanne', N'Manship', N'Joanne Manship'),
    (N'CUDS', N'CUDS', N'AD5246', N'Asiya', N'Ali', N'Asiya Ali'),
    (N'CUDS', N'CUDS', N'AD4649', N'Jessica', N'Bowker', N'Jessica Bowker'),
    (N'CUDS', N'CUDS', N'AD3488', N'Steven', N'Breese', N'Steven Breese'),
    (N'CUDS', N'CUDS', N'AD3990', N'Samantha', N'Bundock', N'Samantha Bundock'),
    (N'CUDS', N'CUDS', N'AD2019', N'Nalini', N'Carooppunnen', N'Nalini Carooppunnen'),
    (N'CUDS', N'CUDS', N'AD5413', N'Liz', N'Cheetham', N'Liz Cheetham'),
    (N'CUDS', N'CUDS', N'AD5656', N'Eliza', N'Glanville', N'Eliza Glanville'),
    (N'CUDS', N'CUDS', N'AD4458', N'Natasha', N'Hall', N'Natasha Hall'),
    (N'CUDS', N'CUDS', N'ST4585', N'Karla', N'Hewitt', N'Karla Hewitt'),
    (N'CUDS', N'CUDS', N'AD4716', N'Abi', N'Olley', N'Abi Olley'),
    (N'CUDS', N'CUDS', N'AD5068', N'Gabrielle', N'Ostmeier', N'Gabrielle Ostmeier'),
    (N'CUDS', N'CUDS', N'AD3775', N'Abigail', N'Scholes', N'Abigail Scholes'),
    (N'CUDS', N'CUDS', N'AD3607', N'Karen', N'Taylor', N'Karen Taylor'),
    (N'CUDS', N'CUDS', N'AD3857', N'Amber', N'Whitehead', N'Amber Whitehead'),
    (N'CUEN', N'CUEN', N'AD5124', N'Lucas', N'Adekoya', N'Lucas Adekoya'),
    (N'CUEN', N'CUEN', N'AD5817', N'Samina', N'Akhtar', N'Samina Akhtar'),
    (N'CUEN', N'CUEN', N'AD5547', N'Rabia', N'Arif', N'Rabia Arif'),
    (N'CUEN', N'CUEN', N'AD3945', N'Chabina', N'Aziz', N'Chabina Aziz'),
    (N'CUEN', N'CUEN', N'AD5643', N'Lisa', N'Gadd', N'Lisa Gadd'),
    (N'CUEN', N'CUEN', N'AD5403', N'Brogan', N'Halpin', N'Brogan Halpin'),
    (N'CUEN', N'CUEN', N'AD5665', N'Danny', N'Hughes', N'Danny Hughes'),
    (N'CUEN', N'CUEN', N'AD5628', N'Hafsah', N'Hussain', N'Hafsah Hussain'),
    (N'CUEN', N'CUEN', N'AD5515', N'Mariam', N'Hussain', N'Mariam Hussain'),
    (N'CUEN', N'CUEN', N'AD4263', N'Laura', N'Johnson', N'Laura Johnson'),
    (N'CUEN', N'CUEN', N'AD5649', N'Zoe', N'McHugh', N'Zoe McHugh'),
    (N'CUEN', N'CUEN', N'AD4906', N'Annabelle', N'Porter-Greenwood', N'Annabelle Porter-Greenwood'),
    (N'CUEN', N'CUEN', N'AD2172', N'Ann', N'Walker', N'Ann Walker'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD3265', N'Julia', N'Christie', N'Julia Christie'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD3993', N'Amy', N'Donnelly', N'Amy Donnelly'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD5631', N'Eve', N'Hamill-Murin', N'Eve Hamill-Murin'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD4218', N'Jacque', N'Linton', N'Jacque Linton'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD2692', N'Louise', N'Maver', N'Louise Maver'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD2087', N'Les', N'Moore', N'Les Moore'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD5799', N'Fagbesa', N'Olawale', N'Fagbesa Olawale'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD3401', N'Andrew', N'Thornley', N'Andrew Thornley'),
    (N'CUEN; CUMT', N'CUEN; CUMT', N'AD1950', N'Patrick', N'Webb', N'Patrick Webb'),
    (N'CUES', NULL, N'AD2153', N'Nerissa', N'Roberts', N'Nerissa Roberts'),
    (N'CUES', N'CUESFT', N'AD5291', N'Sarah', N'Baxter', N'Sarah Baxter'),
    (N'CUES', N'CUESFT', N'AD5744', N'Shamima', N'Begum', N'Shamima Begum'),
    (N'CUES', N'CUESFT', N'AD2842', N'Saba', N'Bukhari', N'Saba Bukhari'),
    (N'CUES', N'CUESFT', N'AD3500', N'Carla', N'Cahill', N'Carla Cahill'),
    (N'CUES', N'CUESFT', N'AD4710', N'Natasha', N'Hodkinson', N'Natasha Hodkinson'),
    (N'CUES', N'CUESFT', N'AD3001', N'Kasim', N'Iqbal', N'Kasim Iqbal'),
    (N'CUES', N'CUESFT', N'AD5794', N'Sidrah', N'Latif', N'Sidrah Latif'),
    (N'CUES', N'CUESFT', N'AD5183', N'Richard', N'Millington', N'Richard Millington'),
    (N'CUES', N'CUESFT', N'AD3839', N'Helen', N'Rivron', N'Helen Rivron'),
    (N'CUES', N'CUESFT', N'AD4950', N'Josie', N'Tetler', N'Josie Tetler'),
    (N'CUES', N'CUESFT', N'AD2098', N'Zahir', N'Vazifdar', N'Zahir Vazifdar'),
    (N'CUES', N'CUESFT', N'AD2866', N'Paul', N'Wells', N'Paul Wells'),
    (N'CUES', N'CUESFT', N'AD3678', N'Anthony', N'Williams', N'Anthony Williams'),
    (N'CUES', N'CUESFT', N'AD5481', N'Syeda', N'Zainab', N'Syeda Zainab'),
    (N'CUES', N'CUESPT', N'AD2439', N'Saima', N'Ali', N'Saima Ali'),
    (N'CUES', N'CUESPT', N'AD5054', N'Elizabeth', N'Dillon Blackwell', N'Elizabeth Dillon Blackwell'),
    (N'CUES', N'CUESPT', N'AD5182', N'Jacqueline', N'Ingham', N'Jacqueline Ingham'),
    (N'CUES', N'CUESPT', N'AD5621', N'Clare', N'Lennon', N'Clare Lennon'),
    (N'CUES', N'CUESPT', N'AD5524', N'Javad', N'Mohammadi', N'Javad Mohammadi'),
    (N'CUES', N'CUESPT', N'AD5457', N'Jawairyah', N'Mukhtar', N'Jawairyah Mukhtar'),
    (N'CUFP', N'CUFPBUS', N'AD4903', N'Sinead', N'Blackledge', N'Sinead Blackledge'),
    (N'CUFP', N'CUFPBUS', N'AD5205', N'Helen', N'Carey', N'Helen Carey'),
    (N'CUFP', N'CUFPBUS', N'AD5800', N'Gar', N'Chan', N'Gar Chan'),
    (N'CUFP', N'CUFPBUS', N'AD5482', N'Amanda', N'Collins', N'Amanda Collins'),
    (N'CUFP', N'CUFPBUS', N'AD4890', N'Holly', N'Cunningham', N'Holly Cunningham'),
    (N'CUFP', N'CUFPBUS', N'AD3325', N'Michael', N'Jackson-Leafield', N'Michael Jackson-Leafield'),
    (N'CUFP', N'CUFPBUS', N'AD5764', N'Laura', N'Jones', N'Laura Jones'),
    (N'CUFP', N'CUFPBUS', N'AD2486', N'Danielle', N'Vipond', N'Danielle Vipond'),
    (N'CUFP', N'CUFPLA', N'AD4773', N'Saubia', N'Ahmed', N'Saubia Ahmed'),
    (N'CUFP', N'CUFPLA', N'AD2292', N'Janette', N'Clancy', N'Janette Clancy'),
    (N'CUFP', N'CUFPLA', N'AD4724', N'Garry', N'Cullen', N'Garry Cullen'),
    (N'CUFP', N'CUFPLA', N'AD2186', N'Janet', N'De-Havillan', N'Janet De-Havillan'),
    (N'CUFP', N'CUFPLA', N'AD3590', N'Dwight', N'Fraser', N'Dwight Fraser'),
    (N'CUFP', N'CUFPLA', N'AD5691', N'Dermot', N'Gill', N'Dermot Gill'),
    (N'CUFP', N'CUFPLA', N'AD2606', N'Sulbia', N'Khanam-Quddus', N'Sulbia Khanam-Quddus'),
    (N'CUFP', N'CUFPLA', N'AD4964', N'Michelle', N'Maher', N'Michelle Maher'),
    (N'CUFP; CUST', NULL, N'AD5762', N'Arooj', N'Parvaiz', N'Arooj Parvaiz'),
    (N'CUFP; CUST', NULL, N'AD2456', N'John', N'Pietrzak', N'John Pietrzak'),
    (N'CUMT', N'CUMT', N'AD5612', N'Samah', N'Ahmed', N'Samah Ahmed'),
    (N'CUMT', N'CUMT', N'AD5526', N'Amatullah', N'Akhtar', N'Amatullah Akhtar'),
    (N'CUMT', N'CUMT', N'AD5248', N'Kwasi', N'Amaning', N'Kwasi Amaning'),
    (N'CUMT', N'CUMT', N'AD5295', N'Robinson', N'Appadoo', N'Robinson Appadoo'),
    (N'CUMT', N'CUMT', N'AD5268', N'Hira', N'Aslam', N'Hira Aslam'),
    (N'CUMT', N'CUMT', N'AD5599', N'Christopher', N'Barnes', N'Christopher Barnes'),
    (N'CUMT', N'CUMT', N'AD3431', N'Elizabeth', N'Bennett', N'Elizabeth Bennett'),
    (N'CUMT', N'CUMT', N'AD1758', N'Kath', N'Bowers', N'Kath Bowers'),
    (N'CUMT', N'CUMT', N'AD4858', N'Clair', N'Butterworth', N'Clair Butterworth'),
    (N'CUMT', N'CUMT', N'AD5642', N'Michelle', N'Guy', N'Michelle Guy'),
    (N'CUMT', N'CUMT', N'AD3855', N'Sameira', N'Khan', N'Sameira Khan'),
    (N'CUMT', N'CUMT', N'AD5594', N'Umair', N'Khan', N'Umair Khan'),
    (N'CUMT', N'CUMT', N'AD5832', N'Jay', N'Krawczyk', N'Jay Krawczyk'),
    (N'CUMT', N'CUMT', N'AD5783', N'Isaac', N'Ninson', N'Isaac Ninson'),
    (N'CUMT', N'CUMT', N'AD5294', N'Chiamaka', N'Okpara', N'Chiamaka Okpara'),
    (N'CUMT', N'CUMT', N'AD4923', N'Bonshad', N'Oliazadeh', N'Bonshad Oliazadeh'),
    (N'CUMT', N'CUMT', N'AD3162', N'Leona', N'Price', N'Leona Price'),
    (N'CUMT', N'CUMT', N'AD3720', N'Nicholas', N'Roberts', N'Nicholas Roberts'),
    (N'CUMT', N'CUMT', N'AD5293', N'Melanie', N'Semple', N'Melanie Semple'),
    (N'CUMT', N'CUMT', N'AD5807', N'John', N'Shelley', N'John Shelley'),
    (N'CUMT', N'CUMT', N'AD4942', N'Jordan', N'Squirrell', N'Jordan Squirrell'),
    (N'CUMT', N'CUMT', N'AD4765', N'Anthony', N'Street', N'Anthony Street'),
    (N'CUMT', N'CUMT', N'AD5725', N'Zeinab', N'Toghani', N'Zeinab Toghani'),
    (N'CUPA', N'CUPAMPA', N'AD3039', N'Georgie', N'Coppinger', N'Georgie Coppinger'),
    (N'CUPA', N'CUPAMPA', N'AD5584', N'William', N'Davidson', N'William Davidson'),
    (N'CUPA', N'CUPAMPA', N'AD4812', N'Thomas', N'Edgerley', N'Thomas Edgerley'),
    (N'CUPA', N'CUPAMPA', N'AD5633', N'William', N'Levison', N'William Levison'),
    (N'CUPA', N'CUPAMPA', N'AD5127', N'Jayne', N'Sladen', N'Jayne Sladen'),
    (N'CUPA', N'CUPAMPA', N'AD5221', N'Jacob', N'Talbot', N'Jacob Talbot'),
    (N'CURC', NULL, N'AD3178', N'Wendy', N'Fletcher', N'Wendy Fletcher'),
    (N'CURC', N'CURCHB', N'AD4936', N'Jacqueline', N'Berry', N'Jacqueline Berry'),
    (N'CURC', N'CURCHB', N'AD4621', N'Chelsea-Leigh', N'Cooke', N'Chelsea-Leigh Cooke'),
    (N'CURC', N'CURCHB', N'AD5619', N'Tina', N'Craven', N'Tina Craven'),
    (N'CURC', N'CURCHB', N'AD3412', N'Nicola', N'Dale', N'Nicola Dale'),
    (N'CURC', N'CURCHB', N'AD4182', N'Rebecca', N'Eddison', N'Rebecca Eddison'),
    (N'CURC', N'CURCHB', N'AD5675', N'Emma', N'Faulkner', N'Emma Faulkner'),
    (N'CURC', N'CURCHB', N'AD4591', N'Catherine', N'Heatley', N'Catherine Heatley'),
    (N'CURC', N'CURCHB', N'AD2572', N'Alison', N'Ibbotson', N'Alison Ibbotson'),
    (N'CURC', N'CURCHB', N'AD5618', N'Daniel', N'Icely', N'Daniel Icely'),
    (N'CURC', N'CURCHB', N'AD5606', N'Yasin', N'Jamal', N'Yasin Jamal'),
    (N'CURC', N'CURCHB', N'AD4960', N'Samantha', N'Lawrey', N'Samantha Lawrey'),
    (N'CURC', N'CURCHB', N'ST5130', N'Susan', N'Lord', N'Susan Lord'),
    (N'CURC', N'CURCHB', N'AD5741', N'Gillian', N'Mcloughlin', N'Gillian Mcloughlin'),
    (N'CURC', N'CURCHB', N'AD3343', N'Elaine', N'Morgan', N'Elaine Morgan'),
    (N'CURC', N'CURCHB', N'AD3852', N'Celina', N'Morley', N'Celina Morley'),
    (N'CURC', N'CURCHB', N'AD5503', N'Ellie', N'Scott', N'Ellie Scott'),
    (N'CURC', N'CURCHB', N'ST5522', N'Dawn', N'Westhead', N'Dawn Westhead'),
    (N'CURC', N'CURCHB', N'AD2049', N'Lynne', N'Winterbottom', N'Lynne Winterbottom'),
    (N'CURC', N'CURCHB', N'AD5546', N'Emma', N'Woolham', N'Emma Woolham'),
    (N'CURC', N'CURCTT', N'AD5692', N'Erin-Mae', N'Connor', N'Erin-Mae Connor'),
    (N'CURC', N'CURCTT', N'AD5730', N'Annabel', N'Culpan', N'Annabel Culpan'),
    (N'CURC', N'CURCTT', N'AD5367', N'Sumayah Sofia', N'Deria', N'Sumayah Sofia Deria'),
    (N'CURC', N'CURCTT', N'AD5143', N'Emma', N'Doodson De Gonzalez', N'Emma Doodson De Gonzalez'),
    (N'CUSE', N'CUSE', N'AD5147', N'Adam', N'Blakeley', N'Adam Blakeley'),
    (N'CUSE', N'CUSE', N'AD5310', N'Claire', N'Cahill', N'Claire Cahill'),
    (N'CUSE', N'CUSE', N'AD5180', N'Heather', N'Jenkinson', N'Heather Jenkinson'),
    (N'CUSE', N'CUSE', N'AD2260', N'Rachel', N'Mason', N'Rachel Mason'),
    (N'CUSE', N'CUSE', N'AD5128', N'Sarah', N'Neild', N'Sarah Neild'),
    (N'CUSE', N'CUSE', N'AD4746', N'William', N'Preston', N'William Preston'),
    (N'CUSE', N'CUSE', N'AD3518', N'Darren', N'Taylor', N'Darren Taylor'),
    (N'CUSE', N'CUSE', N'AD4988', N'Mirza', N'Yasmin', N'Mirza Yasmin'),
    (N'CUST', N'CUSTSPT', N'AD4667', N'Ricky', N'Ashcroft', N'Ricky Ashcroft'),
    (N'CUST', N'CUSTSPT', N'AD5670', N'Zoe', N'Clair', N'Zoe Clair'),
    (N'CUST', N'CUSTSPT', N'AD5169', N'Darran', N'Clegg', N'Darran Clegg'),
    (N'CUST', N'CUSTSPT', N'AD5624', N'Martin', N'Hamer', N'Martin Hamer'),
    (N'CUST', N'CUSTSPT', N'AD5160', N'Dominic', N'Pates', N'Dominic Pates'),
    (N'CUST', N'CUSTSPT', N'AD5610', N'Thomas', N'Pilkington', N'Thomas Pilkington'),
    (N'CUST', N'CUSTSPT', N'AD5634', N'Matthew', N'Powell', N'Matthew Powell'),
    (N'CUST', N'CUSTSPT', N'AD4307', N'Emma', N'Smith', N'Emma Smith'),
    (N'CUST', N'CUSTSPT', N'AD5219', N'Luke', N'Swaby', N'Luke Swaby'),
    (N'CUST', N'CUSTSPT; CUSTUPS', N'AD3479', N'David', N'Jones', N'David Jones'),
    (N'CUST', N'CUSTUPS', N'AD3854', N'Ryan', N'Harris', N'Ryan Harris'),
    (N'CUST', N'CUSTUPS', N'AD3830', N'Nathan', N'Street', N'Nathan Street');

IF (SELECT COUNT(*) FROM @source) <> 271
    THROW 51000, 'The official curriculum staff source must contain exactly 271 rows.', 1;
IF EXISTS (SELECT external_id FROM @source GROUP BY external_id HAVING COUNT(*) > 1)
    THROW 51000, 'The official curriculum staff source contains duplicate account identifiers.', 1;
IF EXISTS (
    SELECT external_id + N'@oldham.ac.uk'
    FROM @source
    GROUP BY external_id + N'@oldham.ac.uk'
    HAVING COUNT(*) > 1
)
    THROW 51000, 'The official curriculum staff source produces duplicate email addresses.', 1;

DECLARE @memberships TABLE (
    external_id nvarchar(50) NOT NULL,
    org_code nvarchar(50) NOT NULL,
    org_unit_type nvarchar(50) NOT NULL,
    is_primary bit NOT NULL,
    PRIMARY KEY (external_id, org_code, org_unit_type)
);

INSERT INTO @memberships (external_id, org_code, org_unit_type, is_primary)
SELECT
    source.external_id,
    LTRIM(RTRIM(split.value)),
    CASE
        WHEN NULLIF(LTRIM(RTRIM(source.team_codes)), N'') IS NOT NULL THEN N'team'
        WHEN source.faculty_codes = N'WBL-CUCB' THEN N'team'
        ELSE N'faculty'
    END,
    CASE WHEN split.ordinal = 1 THEN 1 ELSE 0 END
FROM @source source
CROSS APPLY STRING_SPLIT(
    CASE
        WHEN NULLIF(LTRIM(RTRIM(source.team_codes)), N'') IS NOT NULL THEN source.team_codes
        WHEN source.faculty_codes = N'WBL-CUCB' THEN N'WBL-CUCB'
        ELSE source.faculty_codes
    END,
    N';',
    1
) split;

IF EXISTS (
    SELECT 1
    FROM @memberships membership
    LEFT JOIN org.org_units unit ON unit.code = membership.org_code
        AND unit.org_unit_type = membership.org_unit_type
        AND unit.is_active = 1
        AND unit.archived_at IS NULL
    WHERE unit.id IS NULL
)
BEGIN
    DECLARE @missingCodes nvarchar(max) = (
        SELECT STRING_AGG(membership.org_code, N', ')
        FROM @memberships membership
        LEFT JOIN org.org_units unit ON unit.code = membership.org_code
            AND unit.org_unit_type = membership.org_unit_type
            AND unit.is_active = 1
            AND unit.archived_at IS NULL
        WHERE unit.id IS NULL
    );
    THROW 51000, @missingCodes, 1;
END;

IF @isFirstImport = 1
BEGIN
    -- Remove seeded operational records before removing their staff/user owners.
    DELETE FROM quality.elevate_environment_action_links;
    DELETE FROM ops.notifications;
    DELETE FROM reporting.saved_report_views;
    DELETE FROM evidence.file_attachments;
    DELETE FROM evidence.evidence_items;
    DELETE FROM evidence.file_assets;
    DELETE FROM cpd.cpd_attendance;
    DELETE FROM cpd.cpd_events;
    DELETE FROM quality.work_scrutiny_course_samples;
    DELETE FROM forms.form_responses;
    DELETE FROM forms.form_submissions;
    DELETE FROM quality.learning_walk_details;
    DELETE FROM quality.work_scrutiny_details;
    DELETE FROM quality.activities;
    DELETE FROM quality.elevate_environment_assessments;
    DELETE FROM quality.liv_records;
    DELETE FROM quality.actions;
    DELETE FROM ops.audit_logs;
    DELETE FROM core.records;

    -- Preserve configurable templates even if a demo account originally created them.
    UPDATE forms.form_template_versions
    SET created_by_user_account_id = @adminAccountId
    WHERE created_by_user_account_id IS NOT NULL
      AND created_by_user_account_id <> @adminAccountId;

    UPDATE people.staff SET line_manager_staff_id = NULL;
    DELETE auth_identity
    FROM auth.auth_identities auth_identity
    JOIN auth.user_accounts account ON account.id = auth_identity.user_account_id
    WHERE account.staff_id <> @adminStaffId;
    DELETE scope
    FROM auth.access_scopes scope
    JOIN auth.user_accounts account ON account.id = scope.user_account_id
    WHERE account.staff_id <> @adminStaffId;
    DELETE user_role
    FROM auth.user_roles user_role
    JOIN auth.user_accounts account ON account.id = user_role.user_account_id
    WHERE account.staff_id <> @adminStaffId;
    DELETE membership
    FROM org.staff_org_memberships membership
    WHERE membership.staff_id <> @adminStaffId;
    DELETE FROM auth.user_accounts WHERE staff_id <> @adminStaffId;
    DELETE FROM people.staff WHERE id <> @adminStaffId;
END;

-- The source identifier is both the external staff key and the email local part.
UPDATE staff
SET first_name = source.first_name,
    last_name = source.last_name,
    display_name = source.display_name,
    email = source.external_id + N'@oldham.ac.uk',
    account_status = N'active',
    archived_at = NULL,
    updated_at = sysutcdatetime()
FROM people.staff staff
JOIN @source source ON source.external_id = staff.external_id;

INSERT INTO people.staff (
    id, external_id, first_name, last_name, display_name, email,
    primary_org_unit_id, account_status
)
SELECT
    NEWID(),
    source.external_id,
    source.first_name,
    source.last_name,
    source.display_name,
    source.external_id + N'@oldham.ac.uk',
    (
        SELECT TOP (1) primary_unit.id
        FROM @memberships primary_membership
        JOIN org.org_units primary_unit ON primary_unit.code = primary_membership.org_code
            AND primary_unit.org_unit_type = primary_membership.org_unit_type
        WHERE primary_membership.external_id = source.external_id
          AND primary_membership.is_primary = 1
    ),
    N'active'
FROM @source source
WHERE NOT EXISTS (
    SELECT 1 FROM people.staff existing WHERE existing.external_id = source.external_id
);

UPDATE staff
SET primary_org_unit_id = unit.id,
    updated_at = sysutcdatetime()
FROM people.staff staff
JOIN @memberships membership ON membership.external_id = staff.external_id
    AND membership.is_primary = 1
JOIN org.org_units unit ON unit.code = membership.org_code
    AND unit.org_unit_type = membership.org_unit_type;

INSERT INTO auth.user_accounts (id, staff_id, account_status, is_disabled)
SELECT NEWID(), staff.id, N'active', 0
FROM people.staff staff
JOIN @source source ON source.external_id = staff.external_id
WHERE NOT EXISTS (
    SELECT 1 FROM auth.user_accounts existing
    WHERE existing.staff_id = staff.id AND existing.archived_at IS NULL
);

UPDATE account
SET account_status = N'active',
    is_disabled = 0,
    archived_at = NULL,
    updated_at = sysutcdatetime()
FROM auth.user_accounts account
JOIN people.staff staff ON staff.id = account.staff_id
JOIN @source source ON source.external_id = staff.external_id;

DECLARE @tutorRoleId uniqueidentifier = (
    SELECT id FROM auth.roles WHERE role_key = N'staff' AND archived_at IS NULL
);
IF @tutorRoleId IS NULL
    THROW 51000, 'The Tutor role was not found.', 1;

UPDATE user_role
SET active_to = sysutcdatetime()
FROM auth.user_roles user_role
JOIN auth.user_accounts account ON account.id = user_role.user_account_id
JOIN people.staff staff ON staff.id = account.staff_id
JOIN @source source ON source.external_id = staff.external_id
WHERE user_role.active_from <= sysutcdatetime()
  AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
  AND user_role.role_id <> @tutorRoleId;

INSERT INTO auth.user_roles (user_account_id, role_id)
SELECT account.id, @tutorRoleId
FROM auth.user_accounts account
JOIN people.staff staff ON staff.id = account.staff_id
JOIN @source source ON source.external_id = staff.external_id
WHERE NOT EXISTS (
    SELECT 1
    FROM auth.user_roles existing
    WHERE existing.user_account_id = account.id
      AND existing.role_id = @tutorRoleId
      AND existing.active_from <= sysutcdatetime()
      AND (existing.active_to IS NULL OR existing.active_to > sysutcdatetime())
);

DELETE scope
FROM auth.access_scopes scope
JOIN auth.user_accounts account ON account.id = scope.user_account_id
JOIN people.staff staff ON staff.id = account.staff_id
JOIN @source source ON source.external_id = staff.external_id;

INSERT INTO auth.access_scopes (user_account_id, scope_type, staff_id)
SELECT account.id, N'self', staff.id
FROM auth.user_accounts account
JOIN people.staff staff ON staff.id = account.staff_id
JOIN @source source ON source.external_id = staff.external_id;

DELETE membership
FROM org.staff_org_memberships membership
JOIN people.staff staff ON staff.id = membership.staff_id
JOIN @source source ON source.external_id = staff.external_id;

INSERT INTO org.staff_org_memberships (
    staff_id, org_unit_id, membership_type, is_primary
)
SELECT staff.id, unit.id, N'member', membership.is_primary
FROM @memberships membership
JOIN people.staff staff ON staff.external_id = membership.external_id
JOIN org.org_units unit ON unit.code = membership.org_code
    AND unit.org_unit_type = membership.org_unit_type;

-- The protected administrator remains the sole active Admin with global scope.
UPDATE other_admin
SET active_to = sysutcdatetime()
FROM auth.user_roles other_admin
JOIN auth.roles role ON role.id = other_admin.role_id AND role.role_key = N'super_admin'
WHERE other_admin.user_account_id <> @adminAccountId
  AND other_admin.active_from <= sysutcdatetime()
  AND (other_admin.active_to IS NULL OR other_admin.active_to > sysutcdatetime());

IF NOT EXISTS (
    SELECT 1
    FROM auth.user_roles user_role
    JOIN auth.roles role ON role.id = user_role.role_id
    WHERE user_role.user_account_id = @adminAccountId
      AND role.role_key = N'super_admin'
      AND user_role.active_from <= sysutcdatetime()
      AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
)
BEGIN
    INSERT INTO auth.user_roles (user_account_id, role_id)
    SELECT @adminAccountId, id FROM auth.roles WHERE role_key = N'super_admin';
END;

IF NOT EXISTS (
    SELECT 1 FROM auth.access_scopes
    WHERE user_account_id = @adminAccountId
      AND scope_type = N'global'
      AND is_active = 1
      AND archived_at IS NULL
)
BEGIN
    INSERT INTO auth.access_scopes (user_account_id, scope_type)
    VALUES (@adminAccountId, N'global');
END;

IF NOT EXISTS (SELECT 1 FROM ops.data_import_runs WHERE import_key = @importKey)
BEGIN
    INSERT INTO ops.data_import_runs (import_key, source_name, source_row_count, notes)
    VALUES (
        @importKey,
        N'Curriculum_Staff_List_Coded_with_AD_Numbers.xlsx',
        (SELECT COUNT(*) FROM @source),
        N'Official curriculum staff onboarding. Email address derived as identifier@oldham.ac.uk.'
    );
END;

COMMIT TRANSACTION;
GO
