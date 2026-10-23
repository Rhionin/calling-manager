/* Fictional ward used by the sample board. These are not real members. */
(function (root) {
  function calling(position, memberName, activeDate, setApart) {
    return {
      position: position,
      memberName: memberName,
      activeDate: activeDate || '',
      setApart: setApart
    };
  }

  function org(name, callings, children) {
    return {
      defaultOrgName: name,
      callings: callings || [],
      children: children || []
    };
  }

  var vacant = function (position) { return calling(position, null, '', false); };

  root.SAMPLE_WARD_CALLINGS = [
    org('Bishopric', [
      calling('Bishop', 'Sample, Avery', '20190303', true),
      calling('Bishopric First Counselor', 'Example, Blake', '20220109', true),
      vacant('Bishopric Second Counselor'),
      calling('Ward Executive Secretary', 'Demo, Casey', '20240601', true),
      vacant('Ward Clerk')
    ]),
    org('Elders Quorum', [
      calling('Elders Quorum President', 'Fictional, Dana', '20210315', true),
      calling('Elders Quorum First Counselor', 'Placeholder, Ellis', '20250801', false),
      vacant('Elders Quorum Secretary'),
      calling('Elders Quorum Instructor', 'Notreal, Frankie', '20180620', true)
    ]),
    org('Relief Society', [
      calling('Relief Society President', 'Pretend, Gray', '20200112', true),
      calling('Relief Society First Counselor', 'Imaginary, Hayden', '20230901', true),
      vacant('Relief Society Second Counselor'),
      calling('Relief Society Teacher', 'Madeup, Indigo', '20260201', false)
    ]),
    org('Young Women', [
      calling('Young Women President', 'Testonly, Jules', '20221111', true),
      calling('Young Women Secretary', 'Synthetic, Kai', '20251201', true),
      vacant('Young Women Advisor')
    ]),
    org('Young Men', [
      calling('Young Men President', 'Nobody, Lane', '20210704', true),
      vacant('Young Men Secretary'),
      calling('Young Men Advisor', 'Faux, Morgan', '20240404', true)
    ]),
    org('Primary', [
      calling('Primary President', 'Hypothetical, Noel', '20191101', true),
      calling('Primary First Counselor', 'Mockdata, Ocean', '20230505', true),
      vacant('Primary Secretary')
    ], [
      org('Nursery', [
        calling('Nursery Leader', 'Strawman, Parker', '20220303', true),
        vacant('Nursery Leader')
      ]),
      org('CTR 7', [
        calling('CTR 7 Teacher', 'Paper, Reese', '20260120', false)
      ])
    ]),
    org('Sunday School', [
      vacant('Sunday School President'),
      calling('Sunday School Teacher', 'Standin, Skyler', '20200909', true)
    ]),
    org('Ward Missionaries', [
      calling('Ward Mission Leader', 'Cartoon, Cameron', '20230818', true),
      vacant('Ward Missionary')
    ]),
    org('Other Callings', [
      calling('Music Leader', 'Dummy, Drew', '20250202', true),
      vacant('Organist'),
      vacant('Building Representative')
    ])
  ];

  root.SAMPLE_NAMES_TO_CONSIDER = [
    'Unassigned, Uma',
    'Candidate, Cory',
    'Prospect, Perry'
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
